import 'dotenv/config';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DOMAIN,
  deriveAuthHash,
  generateKeyPair,
  generateRecoveryCode,
  publicKeyToBase64,
  recoveryCodeHash,
  serializeWrappedKey,
  unwrapPrivateKey,
  parseWrappedKey,
  toBase64,
  wrapPrivateKey,
} from '@cipher/crypto';

/// Drives a full account lifecycle against a running server over real HTTP -
/// the same calls the client makes, through the same crypto the client uses.
///
///   npm run smoke
///
/// This is the only place the server workspace touches @cipher/crypto, and it
/// does so as a *client*, not as a server: it derives the authHash and wraps
/// the private key exactly as the browser would, so a passing run proves the
/// two halves genuinely agree rather than that the server agrees with itself.
/// The server code itself must never import that package for anything that
/// decrypts (packages/crypto/AGENTS.md).
///
/// Requires MAIL_TRANSPORT=file, because the verification token exists only in
/// the email (the database stores a hash of it).

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_DIR = process.env.MAIL_DIR ?? '.mail';
const PASSWORD = 'correct-horse-battery-staple';

const stamp = Date.now().toString(36);
const email = `smoke-${stamp}@example.test`;
const username = `smoke${stamp}`;

let failures = 0;

function report(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

interface Called {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Called> {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Leave it as text - a non-JSON body is itself the useful diagnostic.
  }

  if (response.status === 429) {
    // One run spends 6 of the 10 requests /auth/* allows per 15 minutes, so
    // two runs in a row will trip it. Worth saying plainly rather than
    // letting it surface as a confusing failed assertion.
    console.error(
      `\nRate limited on ${method} ${path}.\n` +
        'The auth endpoints allow 10 requests per 15 minutes per IP, and one\n' +
        'smoke run uses 6. Restart `npm run dev` to clear the counter, or wait.\n',
    );
    process.exit(1);
  }

  return { status: response.status, body };
}

/// The newest message written for this address, waiting briefly because the
/// server writes it just after answering the request.
async function latestEmail(to: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const files = (await readdir(MAIL_DIR))
        .filter((f) => f.includes(to.replace(/[^a-zA-Z0-9._@-]/g, '_')))
        .sort();

      const newest = files.at(-1);
      if (newest) return await readFile(join(MAIL_DIR, newest), 'utf8');
    } catch {
      // Directory not created yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `No email appeared in ${MAIL_DIR}/ for ${to}.\n` +
      'Is MAIL_TRANSPORT=file set in .env, and was the dev server restarted?',
  );
}

function tokenFrom(mail: string): string {
  const match = mail.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token in email:\n${mail}`);
  return match[1];
}

async function main(): Promise<void> {
  console.log(`\nserver   ${BASE}`);
  console.log(`account  ${email} / ${username}\n`);

  const health = await call('GET', '/health/ready');
  report('server reachable', health.status === 200, `${health.status} ${JSON.stringify(health.body)}`);
  if (health.status !== 200) {
    console.log('\nIs `npm run dev` running?\n');
    process.exit(1);
  }

  // Everything below happens on the device. The server sees none of it: not
  // PASSWORD, not the recovery code, not the private key.
  const keyPair = await generateKeyPair();
  const recoveryCode = await generateRecoveryCode();
  const authHash = await deriveAuthHash(email, PASSWORD);
  const device = {
    label: 'Smoke Runner',
    publicKey: await publicKeyToBase64(keyPair.publicKey),
    wrappedPrivateKey: serializeWrappedKey(
      await wrapPrivateKey(keyPair.privateKey, PASSWORD, DOMAIN.keywrap),
    ),
    wrappedPrivateKeyRecovery: serializeWrappedKey(
      await wrapPrivateKey(keyPair.privateKey, recoveryCode, DOMAIN.recovery),
    ),
  };

  const registered = await call('POST', '/auth/register', {
    body: {
      email,
      username,
      authHash,
      recoveryCodeHash: await recoveryCodeHash(recoveryCode),
      device,
    },
  });
  report('register', registered.status === 202, `${registered.status}`);

  report(
    'request carried no password, code or private key',
    !JSON.stringify({ email, username, authHash, device }).includes(PASSWORD) &&
      !JSON.stringify(device).includes(recoveryCode.replace(/-/g, '')) &&
      !JSON.stringify(device).includes(await toBase64(keyPair.privateKey)),
    'authHash + opaque blobs only',
  );

  const token = tokenFrom(await latestEmail(email));
  report('verification email received', true, `token ${token.slice(0, 12)}...`);

  const beforeVerify = await call('POST', '/auth/login', {
    body: { email, authHash },
  });
  report(
    'login blocked before verifying',
    beforeVerify.status === 401 && beforeVerify.body.error?.code === 'email_not_verified',
    `${beforeVerify.status} ${beforeVerify.body.error?.code ?? ''}`,
  );

  const verified = await call('POST', '/auth/verify-email', { body: { token } });
  report('verify email', verified.status === 200, `${verified.status}`);

  const replay = await call('POST', '/auth/verify-email', { body: { token } });
  report(
    'verification token is single-use',
    replay.status === 400,
    `${replay.status} ${replay.body.error?.code ?? ''}`,
  );

  const wrongPassword = await call('POST', '/auth/login', {
    body: { email, authHash: await deriveAuthHash(email, 'definitely-not-it') },
  });
  report(
    'wrong password rejected',
    wrongPassword.status === 401,
    `${wrongPassword.status} ${wrongPassword.body.error?.code ?? ''}`,
  );

  const login = await call('POST', '/auth/login', { body: { email, authHash } });
  report('login', login.status === 200, `${login.status} user ${login.body.user?.id ?? '-'}`);

  const { accessToken, refreshToken } = login.body.tokens ?? {};

  // The point of the whole exercise: the blob the server just handed back
  // opens with the password, and yields the key generated before registering.
  let unwrapped = 'no device returned';
  try {
    const privateKey = await unwrapPrivateKey(
      parseWrappedKey(login.body.device.wrappedPrivateKey),
      PASSWORD,
      DOMAIN.keywrap,
    );
    unwrapped =
      (await toBase64(privateKey)) === (await toBase64(keyPair.privateKey))
        ? 'same private key came back'
        : 'WRONG KEY';
  } catch (error) {
    unwrapped = `unwrap failed: ${(error as Error).message}`;
  }
  report('private key survives a round trip', unwrapped === 'same private key came back', unwrapped);

  // And the recovery code opens the other copy, which is what makes a
  // forgotten password survivable.
  let recovered = 'not attempted';
  try {
    const viaCode = await unwrapPrivateKey(
      parseWrappedKey(login.body.device.wrappedPrivateKeyRecovery),
      recoveryCode,
      DOMAIN.recovery,
    );
    recovered =
      (await toBase64(viaCode)) === (await toBase64(keyPair.privateKey))
        ? 'recovery code opens blob_B'
        : 'WRONG KEY';
  } catch (error) {
    recovered = `unwrap failed: ${(error as Error).message}`;
  }
  report('recovery code opens the second copy', recovered === 'recovery code opens blob_B', recovered);

  const me = await call('GET', '/account/me', { token: accessToken });
  report('GET /account/me', me.status === 200 && me.body?.email === email, `${me.status} ${me.body?.username ?? ''}`);

  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken } });
  report(
    'refresh rotates the token',
    refreshed.status === 200 && refreshed.body.tokens?.refreshToken !== refreshToken,
    `${refreshed.status}`,
  );

  const reused = await call('POST', '/auth/refresh', { body: { refreshToken } });
  report(
    'replaying old refresh token is refused',
    reused.status === 401 && reused.body.error?.code === 'refresh_token_reused',
    `${reused.status} ${reused.body.error?.code ?? ''}`,
  );

  // Reuse detection just revoked the whole family, so the rotated token is
  // dead too. That is the intended behaviour, not a failure.
  const afterReuse = await call('POST', '/auth/refresh', {
    body: { refreshToken: refreshed.body.tokens?.refreshToken },
  });
  report(
    'reuse revoked the whole session family',
    afterReuse.status === 401,
    `${afterReuse.status} ${afterReuse.body.error?.code ?? ''}`,
  );

  const staleAccess = await call('GET', '/account/me', { token: refreshed.body.tokens?.accessToken });
  report(
    'access token dies with its session',
    staleAccess.status === 401,
    `${staleAccess.status} ${staleAccess.body.error?.code ?? ''}`,
  );

  console.log(
    failures === 0
      ? `\nAll checks passed. Account ${email} is left in the database.\n`
      : `\n${failures} check(s) failed.\n`,
  );

  if (process.env.SMOKE_KEEP_MAIL !== '1') {
    await rm(MAIL_DIR, { recursive: true, force: true });
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)) + '\n');
  process.exit(1);
});
