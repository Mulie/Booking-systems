import Link from "next/link";
import { query } from "@/lib/db";

export const metadata = { title: "Terms & cancellation policy" };
export const dynamic = "force-dynamic";

export default async function Terms() {
  const policy = (await query("SELECT cancellation_policy FROM shops ORDER BY created_at LIMIT 1"))[0]?.cancellation_policy ?? "";
  return (
    <main className="mx-auto max-w-prose space-y-4 px-4 py-10">
      <Link href="/" className="text-sm underline">← Back</Link>
      <h1 className="text-2xl font-bold">Terms &amp; cancellation policy</h1>
      <h2 className="font-semibold">Cancellation</h2>
      <p>{policy}</p>
      <h2 className="font-semibold">Changes</h2>
      <p>Use the link in your confirmation email to cancel or choose a new time. Inside the cancellation window, please call the shop.</p>
      <h2 className="font-semibold">Late arrivals and no-shows</h2>
      <p>If you are running late, call us. We may have to shorten or reschedule your service so the next customer isn’t kept waiting.</p>
      <p className="text-sm text-gray-600">Template text: have it reviewed before launch.</p>
    </main>
  );
}
