import 'dotenv/config';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import {
  DOMAIN,
  decryptMessage,
  deriveAuthHash,
  encryptMessage,
  generateKeyPair,
  generateRecoveryCode,
  parseCiphertext,
  parseWrappedKey,
  publicKeyToBase64,
  recoveryCodeHash,
  serializeCiphertext,
  serializeWrappedKey,
  unwrapPrivateKey,
  wrapPrivateKey,
  type KeyPair,
} from '@cipher/crypto';

/// Drives two accounts through the whole messaging path against a running
/// server - befriend, open a DM, send, receive live, pull the backlog - using
/// the same @cipher/crypto calls the browser makes.
///
///   npm run smoke:messaging
///
/// Like scripts/smoke.ts, this is the server workspace acting as a *client*.
/// A passing run proves the two halves agree about the envelope format, the
/// socket protocol and the cursor, rather than proving the server agrees with
/// itself.
///
/// The assertion worth the whole script is the last one: the sender can read
/// their own message back out of the server. crypto_box seals to exactly one
/// recipient, so without a copy addressed to themselves a sender on a new
/// device would find their own history unreadable.
///
/// Requires MAIL_TRANSPORT=file, because a verification token exists only in
/// the email.

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_DIR = process.env.MAIL_DIR ?? '.mail';
const PASSWORD = 'correct-horse-battery-staple';

const stamp = Date.now().toString(36);
let failures = 0;

function report(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
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
    console.error(
      `\nRate limited on ${method} ${path}.\n` +
        'The auth endpoints allow 10 requests per 15 minutes per IP, and this\n' +
        'run needs 7. Restart `npm run dev` to clear the counter, or wait.\n',
    );
    process.exit(1);
  }

  return { status: response.status, body };
}

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
  throw new Error(`No email appeared in ${MAIL_DIR}/ for ${to}.`);
}

interface Account {
  email: string;
  username: string;
  id: string;
  accessToken: string;
  keyPair: KeyPair;
}

/// Registers, verifies and signs in one account, generating its identity the
/// way the browser would.
async function createAccount(handle: string): Promise<Account> {
  const email = `smoke-${handle}-${stamp}@example.test`;
  const username = `smoke${handle}${stamp}`;

  const keyPair = await generateKeyPair();
  const recoveryCode = await generateRecoveryCode();
  const authHash = await deriveAuthHash(email, PASSWORD);

  const registered = await call('POST', '/auth/register', {
    body: {
      email,
      username,
      authHash,
      recoveryCodeHash: await recoveryCodeHash(recoveryCode),
      device: {
        label: 'Smoke Runner',
        publicKey: await publicKeyToBase64(keyPair.publicKey),
        wrappedPrivateKey: serializeWrappedKey(
          await wrapPrivateKey(keyPair.privateKey, PASSWORD, DOMAIN.keywrap),
        ),
        wrappedPrivateKeyRecovery: serializeWrappedKey(
          await wrapPrivateKey(keyPair.privateKey, recoveryCode, DOMAIN.recovery),
        ),
      },
    },
  });
  if (registered.status !== 202) throw new Error(`register ${handle}: ${registered.status}`);

  const mail = await latestEmail(email);
  const token = mail.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`no verification token for ${handle}`);
  await call('POST', '/auth/verify-email', { body: { token } });

  const login = await call('POST', '/auth/login', { body: { email, authHash } });
  if (login.status !== 200) throw new Error(`login ${handle}: ${login.status}`);

  // The identity comes back off the server's blob, not out of the variable
  // above - the same way a real client would recover it.
  const privateKey = await unwrapPrivateKey(
    parseWrappedKey(login.body.device.wrappedPrivateKey),
    PASSWORD,
    DOMAIN.keywrap,
  );

  return {
    email,
    username,
    id: login.body.user.id,
    accessToken: login.body.tokens.accessToken,
    keyPair: { publicKey: keyPair.publicKey, privateKey },
  };
}

function connect(token: string): Promise<Socket> {
  const socket = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function nextMessage(socket: Socket, timeoutMs = 5_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message:new arrived')), timeoutMs);
    socket.once('message:new', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main(): Promise<void> {
  console.log(`\nserver   ${BASE}\n`);

  const health = await call('GET', '/health/ready');
  if (health.status !== 200) {
    console.log('Is `npm run dev` running?\n');
    process.exit(1);
  }
  report('server reachable', true, `${health.status}`);

  const alice = await createAccount('a');
  const bob = await createAccount('b');
  report('two accounts registered and signed in', true, `${alice.username} / ${bob.username}`);

  /* ----------------------------------------------------------- friends -- */

  const stranger = await call('GET', `/keys/user/${bob.id}`, { token: alice.accessToken });
  report(
    'a stranger cannot read a public key',
    stranger.status === 404,
    `${stranger.status} ${stranger.body.error?.code ?? ''}`,
  );

  const requested = await call('POST', '/friends/requests', {
    token: alice.accessToken,
    body: { username: bob.username },
  });
  report(
    'friend request sent by exact username',
    requested.status === 200 && requested.body.status === 'pending',
    `${requested.status} ${requested.body.status ?? ''}`,
  );

  const pending = await call('GET', '/friends/requests', { token: bob.accessToken });
  const requestId = pending.body.incoming?.[0]?.id;
  report(
    'the other side sees it as incoming',
    pending.body.incoming?.length === 1 && pending.body.incoming[0].user.username === alice.username,
    `from ${pending.body.incoming?.[0]?.user?.username ?? '-'}`,
  );

  const accepted = await call('POST', `/friends/requests/${requestId}/accept`, {
    token: bob.accessToken,
  });
  report('request accepted', accepted.status === 200, `${accepted.status}`);

  const keys = await call('GET', `/keys/user/${bob.id}`, { token: alice.accessToken });
  report(
    'now the key registry answers, with a public key only',
    keys.status === 200 &&
      keys.body[0]?.publicKey === (await publicKeyToBase64(bob.keyPair.publicKey)) &&
      !JSON.stringify(keys.body).includes('wrapped'),
    `${keys.status} ${String(keys.body[0]?.publicKey ?? '').slice(0, 12)}...`,
  );

  /* ----------------------------------------------------- the conversation -- */

  const opened = await call('POST', '/conversations/dm', {
    token: alice.accessToken,
    body: { userId: bob.id },
  });
  const conversationId = opened.body.id;
  report('DM opened', opened.status === 200 && Boolean(conversationId), `${conversationId ?? '-'}`);

  const reopened = await call('POST', '/conversations/dm', {
    token: bob.accessToken,
    body: { userId: alice.id },
  });
  report(
    'opening it from the other side is the same conversation',
    reopened.body.id === conversationId,
    `${reopened.body.id === conversationId ? 'same id' : 'DIFFERENT ID'}`,
  );

  /* ------------------------------------------------------------ sending -- */

  const PLAINTEXT = 'the rail is done, the workspaces live in the top bar now';

  // One sealed copy per participant, sender included. This is the client's
  // job, and it is what the server validates without being able to open.
  const envelopes = [
    {
      recipientUserId: bob.id,
      ciphertext: serializeCiphertext(
        await encryptMessage(PLAINTEXT, bob.keyPair.publicKey, alice.keyPair.privateKey),
      ),
    },
    {
      recipientUserId: alice.id,
      ciphertext: serializeCiphertext(
        await encryptMessage(PLAINTEXT, alice.keyPair.publicKey, alice.keyPair.privateKey),
      ),
    },
  ];

  const bobSocket = await connect(bob.accessToken);
  const aliceSocket = await connect(alice.accessToken);
  report('both clients connected over websocket', true, 'handshake accepted');

  const arriving = nextMessage(bobSocket);

  const ack = await new Promise<any>((resolve) =>
    aliceSocket.emit(
      'message:send',
      { conversationId, clientId: `c-${stamp}`, envelopes },
      resolve,
    ),
  );
  report('send acknowledged', Boolean(ack?.id), ack?.id ?? JSON.stringify(ack));

  const delivered = await arriving;
  report(
    'delivered live to the other participant',
    delivered.id === ack.id && delivered.authorId === alice.id,
    `${String(delivered.id).slice(0, 8)}... from ${delivered.authorId === alice.id ? 'alice' : '?'}`,
  );

  const bobRead = await decryptMessage(
    parseCiphertext(delivered.ciphertext),
    alice.keyPair.publicKey,
    bob.keyPair.privateKey,
  );
  report('the recipient can open it', bobRead === PLAINTEXT, JSON.stringify(bobRead.slice(0, 40)));

  /* ----------------------------------------------------------- backlog -- */

  const bobBacklog = await call(
    'GET',
    `/conversations/${conversationId}/messages`,
    { token: bob.accessToken },
  );
  report(
    'the backlog carries it too',
    bobBacklog.body.messages?.length === 1 && bobBacklog.body.messages[0].id === ack.id,
    `${bobBacklog.body.messages?.length ?? 0} message(s), cursor ${String(bobBacklog.body.cursor ?? '-').slice(0, 8)}...`,
  );

  // The assertion this whole script exists for.
  const aliceBacklog = await call(
    'GET',
    `/conversations/${conversationId}/messages`,
    { token: alice.accessToken },
  );
  let ownCopy = 'not attempted';
  try {
    ownCopy = await decryptMessage(
      parseCiphertext(aliceBacklog.body.messages[0].ciphertext),
      alice.keyPair.publicKey,
      alice.keyPair.privateKey,
    );
  } catch (error) {
    ownCopy = `failed: ${(error as Error).message}`;
  }
  report(
    'the SENDER can read their own message back',
    ownCopy === PLAINTEXT,
    ownCopy === PLAINTEXT ? 'own envelope opens' : ownCopy,
  );

  // Deliberately not "the two blobs differ": phase 1's encryptMessage ignores
  // the keys, so both copies are byte-identical today and that assertion would
  // fail for the right reason. What holds in both phases is the shape - each
  // caller is handed one ciphertext, never the set - which is the thing a
  // careless `include: { envelopes: true }` would break.
  const shape = bobBacklog.body.messages[0];
  report(
    'each side is handed one envelope, not the set',
    typeof shape.ciphertext === 'string' && !('envelopes' in shape),
    Object.keys(shape).join(', '),
  );

  const cursored = await call(
    'GET',
    `/conversations/${conversationId}/messages?after=${bobBacklog.body.cursor}`,
    { token: bob.accessToken },
  );
  report(
    'a caught-up cursor returns nothing',
    cursored.body.messages?.length === 0,
    `${cursored.body.messages?.length ?? '-'} message(s)`,
  );

  /* ------------------------------------------------------ what leaked -- */

  report(
    'the composed string is not what travelled',
    !JSON.stringify(envelopes).includes(PLAINTEXT),
    // Phase 1 seals to base64 and says alg:"none", so the server *can* read
    // this today. What the assertion pins down is that the plaintext string
    // is not what crosses the wire; at phase 2 the same line holds for real.
    'phase 1: base64 envelope, alg "none"',
  );

  // A third account would be the sharper test, but it costs three more /auth
  // requests and this run already spends six of the ten allowed per quarter
  // hour. Non-participant access is covered by tests/conversations.test.ts.
  const anonymous = await call('GET', `/conversations/${conversationId}/messages`);
  report(
    'an unauthenticated caller cannot read the conversation',
    anonymous.status === 401,
    `${anonymous.status} ${anonymous.body.error?.code ?? ''}`,
  );

  bobSocket.disconnect();
  aliceSocket.disconnect();

  console.log(
    failures === 0
      ? `\nAll checks passed.\n`
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
