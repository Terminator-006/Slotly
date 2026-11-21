import { DateTime } from "luxon";
import nodemailer from "nodemailer";
import type { Booking, Business, Service } from "./schema";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Anything that can deliver an email. Swap implementations without touching callers. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Default: print to the server console. No account, no keys, no network. */
export class ConsoleMailer implements Mailer {
  async send(email: Email): Promise<void> {
    console.log(`\n[slotly:mail] to=${email.to}\n  subject: ${email.subject}\n  ${email.text.replace(/\n/g, "\n  ")}\n`);
  }
}

/** Resend over plain fetch: one less dependency. Free tier is enough for a portfolio demo. */
export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(email: Email): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}

/** The one method of a nodemailer transport we use (lets tests pass a fake). */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * Any SMTP server, including Gmail (smtp.gmail.com + an App Password).
 * Handy for demos: sends to any recipient with no domain verification.
 * For production prefer a transactional provider (Resend, Postmark, SES).
 */
export class SmtpMailer implements Mailer {
  constructor(
    private transport: MailTransport,
    private from: string,
  ) {}

  async send(email: Email): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: email.to, subject: email.subject, text: email.text });
  }
}

/**
 * Pick a mailer from the environment, first match wins:
 *   1. RESEND_API_KEY            -> Resend
 *   2. SMTP_USER + SMTP_PASS     -> SMTP (Gmail by default)
 *   3. nothing                   -> print to the console
 */
export function getMailer(): Mailer {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return new ResendMailer(resendKey, process.env.MAIL_FROM ?? "Slotly <onboarding@resend.dev>");
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (user && pass) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS on 587
      auth: { user, pass },
    });
    return new SmtpMailer(transport, process.env.MAIL_FROM ?? `Slotly <${user}>`);
  }

  return new ConsoleMailer();
}

/** A failed email must never fail the booking: log and carry on. */
export async function safeSend(mailer: Mailer, email: Email): Promise<void> {
  try {
    await mailer.send(email);
  } catch (e) {
    console.error("[slotly:mail] delivery failed", e);
  }
}

function when(booking: Booking, business: Business): string {
  return DateTime.fromMillis(booking.startsAt, { zone: business.timezone }).toFormat("cccc d LLLL yyyy 'at' HH:mm (ZZZZ)");
}

export function bookingConfirmedEmail(booking: Booking, business: Business, service: Service): Email {
  return {
    to: booking.customerEmail,
    subject: `Booked: ${service.name} at ${business.name}`,
    text: [
      `Hi ${booking.customerName},`,
      "",
      `Your ${service.name} (${service.durationMin} min) at ${business.name} is confirmed for`,
      when(booking, business) + ".",
      "",
      "Need to change it? Reply to this email or contact the business directly.",
    ].join("\n"),
  };
}

export function bookingOwnerAlertEmail(to: string, booking: Booking, business: Business, service: Service): Email {
  return {
    to,
    subject: `New booking: ${booking.customerName} (${service.name})`,
    text: `${booking.customerName} <${booking.customerEmail}> booked ${service.name} on ${when(booking, business)}.`,
  };
}

export function bookingCancelledEmail(booking: Booking, business: Business, service: Service): Email {
  return {
    to: booking.customerEmail,
    subject: `Cancelled: ${service.name} at ${business.name}`,
    text: `Hi ${booking.customerName},\n\nYour ${service.name} appointment on ${when(booking, business)} has been cancelled by ${business.name}.`,
  };
}
