import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';

export interface OutboundMail {
  to: string;
  subject: string;
  /// Always present, and always the authoritative version. Every template
  /// writes the text part first and derives the HTML from it, so a client that
  /// refuses HTML - or a developer reading .mail/ - loses nothing but styling.
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

/// Provider-agnostic on purpose: development points at Mailpit over plain
/// SMTP, and switching to Resend/SES/whatever later is an env change plus a
/// new implementation of this interface, not a change to any call site.
export class SmtpMailer implements Mailer {
  private transporter: Transporter;

  constructor() {
    // Port 1025 is Mailpit, which speaks plain SMTP and has no certificate.
    // Anything else is a real relay carrying verification links across the
    // internet, so TLS is required rather than merely attempted: without
    // `requireTLS`, nodemailer silently continues in the clear if STARTTLS is
    // missing, which is exactly the failure you would never notice.
    const isLocalMailpit = env.SMTP_PORT === 1025;

    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; 587 (what Resend, Postmark, Brevo and Mailgun all
      // use) starts plain and upgrades via STARTTLS.
      secure: env.SMTP_PORT === 465,
      ignoreTLS: isLocalMailpit,
      requireTLS: !isLocalMailpit,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' }
        : undefined,
      // Signup bursts send a handful of messages, not thousands. Pooling keeps
      // one authenticated connection warm instead of paying a TLS handshake
      // per email.
      pool: true,
      maxConnections: 2,
    });
  }

  /// Opens a connection and authenticates without sending anything. Used by
  /// `npm run mail:test` to separate "the credentials are wrong" from "the
  /// message was rejected", which are otherwise the same opaque failure.
  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(mail: OutboundMail): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
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

/// Emails are written text-first and the HTML is a rendering of the same
/// words, never extra content. Two reasons: the text part is what lands in
/// `.mail/` during development and in the smoke scripts, so it has to stay
/// self-sufficient; and a transactional message whose HTML says more than its
/// text is the kind of thing spam filters score against.
interface Template {
  subject: string;
  /// One line summarising the mail, shown in the inbox preview strip.
  preheader: string;
  heading: string;
  /// Rendered as one paragraph each, in both parts.
  paragraphs: string[];
  action?: { label: string; url: string };
  /// Smaller, greyer, after the action. Still plain sentences.
  footnotes?: string[];
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/// The "Ember" palette, copied from client/src/styles/theme.css and inlined by
/// hand. Email clients strip <style> and external CSS, so every rule below is
/// an inline attribute and there is no way to share the real stylesheet - if
/// the tokens there change, these change with them.
///
/// These are the *light* tokens deliberately. The app is dark by default, but
/// a dark email renders unpredictably: several clients invert colours they
/// think are wrong, and the ones that don't leave you fighting the reading
/// pane's own background. Warm paper is the same design system in daylight.
const PAPER = '#e8e1d8';   // --bg-app
const CARD = '#fffcf8';    // --bg-panel-alt
const BORDER = '#ddd3c7';  // --line
const INK = '#1f1a17';     // --text-hi
const BODY = '#453d38';    // --text
const MUTED = '#7c7168';   // --text-mute
const EMBER = '#d1552e';   // --ember: the only interactive colour
const ON_EMBER = '#fffcf8'; // --ember-ink

function renderText(template: Template): string {
  return [
    ...template.paragraphs,
    ...(template.action ? ['', template.action.url] : []),
    ...(template.footnotes ? ['', ...template.footnotes] : []),
  ].join('\n');
}

function renderHtml(template: Template): string {
  // Footnotes are set smaller as well as greyer: at the same size as the body
  // they read as more of the message, which is the opposite of the point.
  const paragraph = (body: string, muted = false): string =>
    `<p style="margin:0 0 ${muted ? 8 : 16}px;font-size:${
      muted ? 13 : 15
    }px;line-height:1.6;color:${muted ? MUTED : BODY};">${escapeHtml(body)}</p>`;

  const button = template.action
    ? `<p style="margin:0 0 24px;"><a href="${escapeHtml(template.action.url)}"
         style="display:inline-block;padding:12px 22px;border-radius:8px;
                background:${EMBER};color:${ON_EMBER};font-size:15px;
                font-weight:600;text-decoration:none;">${escapeHtml(
                  template.action.label,
                )}</a></p>
       <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:${MUTED};">
         If the button does not work, paste this into your browser:<br>
         <span style="word-break:break-all;color:${EMBER};">${escapeHtml(
           template.action.url,
         )}</span>
       </p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:${PAPER};
               font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
    <span style="display:none;font-size:1px;color:${PAPER};">${escapeHtml(
      template.preheader,
    )}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;margin:0 auto;background:${CARD};
                  border:1px solid ${BORDER};border-radius:12px;">
      <tr>
        <td style="padding:28px 32px;">
          <img src="${escapeHtml(env.APP_URL)}/logo.png" width="36" height="36" alt=""
               style="display:block;margin:0 0 20px;border-radius:8px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK};">${escapeHtml(
            template.heading,
          )}</h1>
          ${template.paragraphs.map((line) => paragraph(line)).join('\n          ')}
          ${button}
          ${(template.footnotes ?? []).map((line) => paragraph(line, true)).join('\n          ')}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const render = (template: Template): Omit<OutboundMail, 'to'> => ({
  subject: template.subject,
  text: renderText(template),
  html: renderHtml(template),
});

export const verificationEmail = (token: string): Omit<OutboundMail, 'to'> =>
  render({
    subject: 'Verify your email address',
    preheader: 'Confirm your address to finish setting up your account.',
    heading: 'Confirm your email address',
    paragraphs: [
      'Welcome. Confirm your email address to finish setting up your account:',
    ],
    action: {
      label: 'Verify email address',
      url: `${env.APP_URL}/verify-email?token=${token}`,
    },
    footnotes: [
      'This link expires in 24 hours.',
      "If you didn't create an account, you can ignore this email.",
    ],
  });

/// Sent when someone tries to register with an address that already has an
/// account. Registration can't say "that email is taken" without becoming an
/// account-enumeration oracle, so the person who owns the address is told
/// instead - they're the only one entitled to know.
export const alreadyRegisteredEmail = (): Omit<OutboundMail, 'to'> =>
  render({
    subject: 'Someone tried to register with your email address',
    preheader: 'No new account was created and nothing changed.',
    heading: 'Someone tried to register with your address',
    paragraphs: [
      'Someone just tried to create an account using this email address, but you already have one.',
      `If that was you, sign in instead: ${env.APP_URL}/login`,
      `If you've forgotten your password: ${env.APP_URL}/forgot-password`,
    ],
    footnotes: [
      "If it wasn't you, no action is needed - no new account was created and your existing account was not changed.",
    ],
  });
