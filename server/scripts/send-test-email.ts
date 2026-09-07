import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { env } from '../src/env.js';
import {
  SmtpMailer,
  alreadyRegisteredEmail,
  verificationEmail,
} from '../src/lib/mailer.js';

/// Proves the mail relay works, before anything depends on it.
///
///   npm run mail:test -- you@yourdomain.com
///   npm run mail:test -- --preview          (renders to disk, sends nothing)
///
/// This exists because mail is the one hard blocker on hosting: verification
/// is required before login, so if sending is broken nobody can create an
/// account - including you - and the failure shows up as a signup that
/// silently never completes. Finding that out here costs a minute; finding it
/// out after the box is live costs an evening.
///
/// It separates the two failures that otherwise look identical from the app:
/// the connection/credentials being wrong (verify) and the message itself
/// being rejected (send). A provider refusing your From address is the common
/// second case, and it only ever surfaces at send time.

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const recipient = args.find((arg) => !arg.startsWith('--'));

/// A token-shaped string. Nothing consumes it - the point is that the rendered
/// link looks exactly like a real one, so a broken APP_URL is visible.
const SAMPLE_TOKEN = 'sample-token-this-link-will-not-verify-anything';

async function writePreviews(): Promise<void> {
  const samples = [
    ['verification', verificationEmail(SAMPLE_TOKEN)],
    ['already-registered', alreadyRegisteredEmail()],
  ] as const;

  for (const [name, mail] of samples) {
    const html = `${env.MAIL_DIR}/preview-${name}.html`;
    const text = `${env.MAIL_DIR}/preview-${name}.txt`;
    await writeFile(html, mail.html ?? '', 'utf8');
    await writeFile(text, mail.text, 'utf8');
    console.log(`  ${mail.subject}\n    ${html}\n    ${text}`);
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log(`  MAIL_TRANSPORT  ${env.MAIL_TRANSPORT}  (this script bypasses it)`);
  console.log(`  MAIL_FROM       ${env.MAIL_FROM}`);
  console.log(`  APP_URL         ${env.APP_URL}`);

  if (preview) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(env.MAIL_DIR, { recursive: true });
    console.log('\n  Rendering, not sending:\n');
    await writePreviews();
    console.log('\n  Open the .html files in a browser.\n');
    return;
  }

  if (!recipient) {
    console.error(
      '\n  Usage: npm run mail:test -- you@yourdomain.com' +
        '\n         npm run mail:test -- --preview\n',
    );
    process.exit(2);
  }

  // Deliberately NOT gated on MAIL_TRANSPORT. This script builds an SmtpMailer
  // directly, so it can prove the relay works while the app is still on the
  // `file` transport - which matters because both smoke scripts require
  // `file`, and demanding a config change in order to run a test is how you
  // end up testing a configuration you then revert.
  //
  // What does need checking is that SMTP_* points somewhere real: aimed at
  // Mailpit this 'succeeds' without anything leaving the machine, which is
  // the one outcome worse than failing.
  const looksLocal =
    env.SMTP_PORT === 1025 ||
    ['localhost', '127.0.0.1', '::1', 'mailpit'].includes(env.SMTP_HOST);

  if (looksLocal) {
    console.error(
      `\n  SMTP points at ${env.SMTP_HOST}:${env.SMTP_PORT}, which is a local mail` +
        '\n  catcher. Nothing would leave this machine and the test would pass' +
        '\n  anyway. Point SMTP_HOST/PORT/USER/PASSWORD at the real provider\'s' +
        '\n  settings first - MAIL_TRANSPORT can stay exactly as it is.\n',
    );
    process.exit(2);
  }

  console.log(`  SMTP            ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  console.log(`  To              ${recipient}`);
  console.log('');

  const mailer = new SmtpMailer();

  try {
    await mailer.verify();
    console.log('  ok    connected and authenticated');
  } catch (error) {
    console.error('  FAIL  could not connect or authenticate');
    console.error(`        ${(error as Error).message}`);
    console.error(
      '\n  Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD. Most' +
        '\n  providers want the API key as the password and a fixed username.\n',
    );
    process.exit(1);
  }

  try {
    await mailer.send({ to: recipient, ...verificationEmail(SAMPLE_TOKEN) });
    console.log('  ok    accepted for delivery');
  } catch (error) {
    console.error('  FAIL  the relay refused the message');
    console.error(`        ${(error as Error).message}`);
    console.error(
      `\n  MAIL_FROM is ${env.MAIL_FROM}. Providers reject a From address on a` +
        '\n  domain you have not verified, which is the usual cause here.\n',
    );
    process.exit(1);
  }

  console.log(
    '\n  Sent. Check the inbox, and check spam - a domain sending its first' +
      '\n  mail often lands there until SPF, DKIM and DMARC are all passing.\n',
  );
}

await main();
process.exit(0);
