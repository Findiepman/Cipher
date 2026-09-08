import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DOMAIN,
  deriveAuthHash,
  generateKeyPair,
  generateRecoveryCode,
  publicKeyToBase64,
  recoveryCodeHash,
  serializeWrappedKey,
  wrapPrivateKey,
} from '@cipher/crypto';

/// Makes one verified account and prints what to type into the sign-in form.
///
///   npm run account                       a generated name
///   npm run account -- bob                bob@example.test
///   npm run account -- bob hunter2hunter2 a password of your own
///
/// Why this exists: testing anything that involves two people (the message
/// chime, an incoming call, friend requests) needs a second account, and doing
/// that by hand means registering, finding the right file in .mail, and
/// pulling the token out of it. This is the same dance `smoke.ts` already
/// does, stopped at the point where the account works and left there instead
/// of exercised and thrown away.
///
/// Requires MAIL_TRANSPORT=file, because the verification token exists only in
/// the email: the database stores a hash of it.
///
/// Delete this file freely. Nothing depends on it.

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_DIR = process.env.MAIL_DIR ?? '.mail';

const stamp = Date.now().toString(36);
const name = process.argv[2] ?? `tester${stamp}`;
const password = process.argv[3] ?? 'correct-horse-battery-staple';
const email = name.includes('@') ? name : `${name}@example.test`;
const username = name.includes('@') ? name.split('@')[0]! : name;

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

/// The newest message for this address. Waited for, because the server writes
/// it just after it answers the request rather than before.
async function verificationToken(to: string): Promise<string> {
  const stem = to.replace(/[^a-zA-Z0-9._@-]/g, '_');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const files = (await readdir(MAIL_DIR)).filter((f) => f.includes(stem)).sort();
      const newest = files.at(-1);
      if (newest) {
        const body = await readFile(join(MAIL_DIR, newest), 'utf8');
        const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(body);
        if (match) return match[1]!;
      }
    } catch {
      // .mail does not exist until the first message is written.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No verification email appeared in ${MAIL_DIR}/ for ${to}.\n` +
      'Is MAIL_TRANSPORT=file in server/.env, and is the server running?',
  );
}

const keyPair = await generateKeyPair();
const recoveryCode = await generateRecoveryCode();
const authHash = await deriveAuthHash(email, password);

const registered = await post('/auth/register', {
  email,
  username,
  authHash,
  recoveryCodeHash: await recoveryCodeHash(recoveryCode),
  device: {
    label: 'Made by make-account',
    publicKey: await publicKeyToBase64(keyPair.publicKey),
    wrappedPrivateKey: serializeWrappedKey(
      await wrapPrivateKey(keyPair.privateKey, password, DOMAIN.keywrap),
    ),
    wrappedPrivateKeyRecovery: serializeWrappedKey(
      await wrapPrivateKey(keyPair.privateKey, recoveryCode, DOMAIN.recovery),
    ),
  },
});

if (registered.status !== 202) {
  console.error(`register failed: ${registered.status}`, registered.body);
  process.exit(1);
}

const verified = await post('/auth/verify-email', { token: await verificationToken(email) });
if (verified.status !== 200) {
  console.error(`verify failed: ${verified.status}`, verified.body);
  process.exit(1);
}

console.log(`
Account ready. Sign in at http://localhost:5173

  email     ${email}
  username  ${username}
  password  ${password}

  recovery  ${recoveryCode}
            Only shown here. Nothing can print it again.
`);
