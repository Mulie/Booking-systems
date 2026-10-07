import Link from "next/link";

export const metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-prose space-y-4 px-4 py-10">
      <Link href="/" className="text-sm underline">← Back</Link>
      <h1 className="text-2xl font-bold">Privacy policy</h1>
      <p>We collect only what we need to run your appointment: your name, mobile number and (optionally) your email address.</p>
      <h2 className="font-semibold">How we use it</h2>
      <p>To confirm, change or cancel your appointment, and to contact you if something about it changes. We do not sell your information or use it for marketing.</p>
      <h2 className="font-semibold">Who sees it</h2>
      <p>Shop staff, and the service providers we use to send email and keep a staff calendar (for example Google Calendar and our email provider).</p>
      <h2 className="font-semibold">Retention and deletion</h2>
      <p>We keep appointment records only as long as needed for operations and legal requirements. To have your details deleted or anonymized, contact the shop.</p>
      <h2 className="font-semibold">Payments</h2>
      <p>We do not collect payment details online.</p>
      <p className="text-sm text-gray-600">Template text: have it reviewed against PIPEDA and your own practices before launch.</p>
    </main>
  );
}
