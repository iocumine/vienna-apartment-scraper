import nodemailer from 'nodemailer';
import type { EmailMessage, Emailer, SmtpConfig } from '../types.js';

interface TransportLike {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

// Thin wrapper around a nodemailer transport. Pass `transport` in tests to avoid SMTP.
export function createEmailer(
  smtp: SmtpConfig,
  { transport }: { transport?: TransportLike } = {},
): Emailer {
  const tx: TransportLike =
    transport ??
    nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });

  async function send({ to, subject, text, html }: EmailMessage): Promise<unknown> {
    if (!to) throw new Error('email recipient (to) is required');
    return tx.sendMail({ from: smtp.from || smtp.user, to, subject, text, html });
  }

  return { send };
}
