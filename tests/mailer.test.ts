import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleMailer, ResendMailer, SmtpMailer, getMailer, safeSend } from "../lib/mailer";

afterEach(() => vi.unstubAllEnvs());

function clearMailEnv() {
  for (const k of ["RESEND_API_KEY", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM"]) vi.stubEnv(k, "");
}

describe("getMailer", () => {
  it("falls back to the console when nothing is configured", () => {
    clearMailEnv();
    expect(getMailer()).toBeInstanceOf(ConsoleMailer);
  });

  it("uses SMTP when SMTP_USER and SMTP_PASS are set", () => {
    clearMailEnv();
    vi.stubEnv("SMTP_USER", "me@gmail.com");
    vi.stubEnv("SMTP_PASS", "app-password");
    expect(getMailer()).toBeInstanceOf(SmtpMailer);
  });

  it("needs both SMTP values, otherwise it stays on the console", () => {
    clearMailEnv();
    vi.stubEnv("SMTP_USER", "me@gmail.com");
    expect(getMailer()).toBeInstanceOf(ConsoleMailer);
  });

  it("prefers Resend over SMTP when both are configured", () => {
    clearMailEnv();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("SMTP_USER", "me@gmail.com");
    vi.stubEnv("SMTP_PASS", "app-password");
    expect(getMailer()).toBeInstanceOf(ResendMailer);
  });
});

describe("SmtpMailer", () => {
  it("hands the message to the transport with the configured sender", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    await new SmtpMailer({ sendMail }, "Slotly <me@gmail.com>").send({ to: "ada@example.com", subject: "Booked", text: "Hi Ada" });
    expect(sendMail).toHaveBeenCalledWith({ from: "Slotly <me@gmail.com>", to: "ada@example.com", subject: "Booked", text: "Hi Ada" });
  });

  it("never lets a transport failure escape safeSend (a bad email must not fail a booking)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer = new SmtpMailer({ sendMail: vi.fn().mockRejectedValue(new Error("535 bad credentials")) }, "x");
    await expect(safeSend(mailer, { to: "a@b.c", subject: "s", text: "t" })).resolves.toBeUndefined();
  });
});
