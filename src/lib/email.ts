import { DateTime } from "luxon";
import { env } from "./env";

export type MailBooking = {
  id: string;
  token: string;
  customerName: string;
  customerEmail: string;
  serviceName: string;
  barberName: string;
  startsAt: Date;
  price: string;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  timezone: string;
  cancellationPolicy: string;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderEmail(kind: "CONFIRMED" | "CANCELLED" | "RESCHEDULED", b: MailBooking) {
  const when = DateTime.fromJSDate(b.startsAt, { zone: b.timezone }).toFormat("cccc, LLLL d 'at' h:mm a");
  const link = `${env.appUrl}/booking/${b.id}?token=${b.token}`;
  const heading = { CONFIRMED: "You're booked.", RESCHEDULED: "Your appointment was moved.", CANCELLED: "Your appointment was cancelled." }[kind];
  const rows = [
    ["Service", b.serviceName],
    ["Barber", b.barberName],
    ["When", when],
    ["Price", `$${b.price}`],
    ["Where", `${b.shopName}, ${b.shopAddress}`],
  ];
  const text = [
    heading,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    kind === "CANCELLED" ? `Book again: ${env.appUrl}/book` : `Cancel or reschedule: ${link}`,
    b.cancellationPolicy,
    b.shopPhone && `Questions? ${b.shopPhone}`,
  ].filter(Boolean).join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h1 style="font-size:22px">${esc(heading)}</h1>
<table style="width:100%;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#555">${k}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`)
    .join("")}</table>
<p>${kind === "CANCELLED" ? `<a href="${env.appUrl}/book">Book again</a>` : `<a href="${link}">Cancel or reschedule</a>`}</p>
<p style="color:#555;font-size:13px">${esc(b.cancellationPolicy)}</p></div>`;
  const subject = { CONFIRMED: "Your appointment is confirmed", RESCHEDULED: "Your appointment was rescheduled", CANCELLED: "Your appointment was cancelled" }[kind];
  return { subject, text, html };
}

/** Sends via Resend when configured; otherwise logs (dev/staging). Throws on provider failure so the job retries. */
export async function sendEmail(to: string, m: { subject: string; text: string; html: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${m.subject}"\n${m.text}`);
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject: m.subject, text: m.text, html: m.html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}
