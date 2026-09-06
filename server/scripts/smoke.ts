import 'dotenv/config';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/// Drives a full account lifecycle against a running server over real HTTP -
/// the same calls the client will make. Stands in for the frontend while it
/// does not exist yet.
///
///   npm run smoke
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

  const registered = await call('POST', '/auth/register', {
    body: { email, username, password: PASSWORD },
  });
  report('register', registered.status === 202, `${registered.status} ${registered.body.message ?? ''}`);

  const token = tokenFrom(await latestEmail(email));
  report('verification email received', true, `token ${token.slice(0, 12)}...`);

  const beforeVerify = await call('POST', '/auth/login', {
    body: { identifier: email, password: PASSWORD },
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
    body: { identifier: email, password: 'definitely-not-the-password' },
  });
  report(
    'wrong password rejected',
    wrongPassword.status === 401,
    `${wrongPassword.status} ${wrongPassword.body.error?.code ?? ''}`,
  );

  const login = await call('POST', '/auth/login', {
    body: { identifier: email, password: PASSWORD },
  });
  report('login', login.status === 200, `${login.status} user ${login.body.user?.id ?? '-'}`);

  const { accessToken, refreshToken } = login.body;

  const me = await call('GET', '/account/me', { token: accessToken });
  report('GET /account/me', me.status === 200 && me.body.user?.email === email, `${me.status} ${me.body.user?.username ?? ''}`);

  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken } });
  report(
    'refresh rotates the token',
    refreshed.status === 200 && refreshed.body.refreshToken !== refreshToken,
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
    body: { refreshToken: refreshed.body.refreshToken },
  });
  report(
    'reuse revoked the whole session family',
    afterReuse.status === 401,
    `${afterReuse.status} ${afterReuse.body.error?.code ?? ''}`,
  );

  const staleAccess = await call('GET', '/account/me', { token: refreshed.body.accessToken });
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
