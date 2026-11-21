import { DateTime } from "luxon";
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

export function getMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  if (!key) return new ConsoleMailer();
  return new ResendMailer(key, process.env.MAIL_FROM ?? "Slotly <onboarding@resend.dev>");
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
