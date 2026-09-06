import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

/// Provider-agnostic on purpose: development points at Mailpit over plain
/// SMTP, and switching to Resend/SES/whatever later is an env change plus a
/// new implementation of this interface, not a change to any call site.
class SmtpMailer implements Mailer {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Mailpit listens on plain SMTP; real providers upgrade via STARTTLS.
      secure: env.SMTP_PORT === 465,
      ignoreTLS: env.SMTP_PORT === 1025,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' }
        : undefined,
    });
  }

  async send(mail: OutboundMail): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

/// Used in tests: keeps everything in memory so a test can assert on what was
/// sent and pull the token straight out of the body.
export class InMemoryMailer implements Mailer {
  readonly sent: OutboundMail[] = [];

  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
  }

  lastTo(address: string): OutboundMail | undefined {
    return [...this.sent].reverse().find((m) => m.to === address);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/// Prints the message instead of sending it. For local development without a
/// mail container: the verification link is right there in the server log.
class ConsoleMailer implements Mailer {
  async send(mail: OutboundMail): Promise<void> {
    console.info(
      [
        '',
        '--- email (not sent: MAIL_TRANSPORT=console) ---',
        `To:      ${mail.to}`,
        `Subject: ${mail.subject}`,
        '',
        mail.text,
        '--- end email ---',
        '',
      ].join('\n'),
    );
  }
}

/// Writes each message to a file instead of sending it, so a script can read
/// the verification link back out, and prints the link to the console so a
/// human can just click it. The token only ever exists in the email - the
/// database stores a hash - so this is the one way to run the real signup flow
/// end to end without a mail server.
class FileMailer implements Mailer {
  async send(mail: OutboundMail): Promise<void> {
    await mkdir(env.MAIL_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = mail.to.replace(/[^a-zA-Z0-9._@-]/g, '_');
    const file = join(env.MAIL_DIR, `${stamp}--${safeTo}.txt`);

    await writeFile(
      file,
      [`To: ${mail.to}`, `Subject: ${mail.subject}`, '', mail.text, ''].join('\n'),
      'utf8',
    );

    announce(mail, file);
  }
}

/// The actionable part of a development email, on the console.
///
/// Writing the file is enough for a script, but not for a person signing up
/// through the UI: they should not have to go hunting through a directory for
/// the one file that still works. Only the newest verification email for an
/// address is live - issuing a token deletes the previous one - so an older
/// file in MAIL_DIR is a dead link and the log is the reliable place to look.
///
/// Deliberately console.info and not the Fastify logger: that one redacts
/// tokens by design, which is right for a request log and useless here. This
/// only ever runs under MAIL_TRANSPORT=file, which env.ts refuses in production.
function announce(mail: OutboundMail, file: string): void {
  const link = mail.text.match(/https?:\/\/\S+/)?.[0];

  console.info(
    [
      '',
      '--- email (not sent: MAIL_TRANSPORT=file) ---',
      `To:      ${mail.to}`,
      `Subject: ${mail.subject}`,
      ...(link ? [`Link:    ${link}`] : []),
      `File:    ${file}`,
      '--- end email ---',
      '',
    ].join('\n'),
  );
}

export function createMailer(): Mailer {
  switch (env.MAIL_TRANSPORT) {
    case 'console':
      return new ConsoleMailer();
    case 'file':
      return new FileMailer();
    default:
      return new SmtpMailer();
  }
}

export const verificationEmail = (token: string): Omit<OutboundMail, 'to'> => ({
  subject: 'Verify your email address',
  text: [
    'Welcome. Confirm your email address to finish setting up your account:',
    '',
    `${env.APP_URL}/verify-email?token=${token}`,
    '',
    'This link expires in 24 hours.',
    "If you didn't create an account, you can ignore this email.",
  ].join('\n'),
});

/// Sent when someone tries to register with an address that already has an
/// account. Registration can't say "that email is taken" without becoming an
/// account-enumeration oracle, so the person who owns the address is told
/// instead - they're the only one entitled to know.
export const alreadyRegisteredEmail = (): Omit<OutboundMail, 'to'> => ({
  subject: 'Someone tried to register with your email address',
  text: [
    'Someone just tried to create an account using this email address, but',
    'you already have one.',
    '',
    `If that was you, sign in instead: ${env.APP_URL}/login`,
    `If you've forgotten your password: ${env.APP_URL}/forgot-password`,
    '',
    "If it wasn't you, no action is needed - no new account was created and",
    'your existing account was not changed.',
  ].join('\n'),
});
