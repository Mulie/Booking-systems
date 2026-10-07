import Link from "next/link";
import { query } from "@/lib/db";
import { getDefaultShopId } from "@/lib/slots";
import { DateTime } from "luxon";

export const dynamic = "force-dynamic";

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmt = (m: number) => DateTime.fromObject({ hour: Math.floor(m / 60) % 24, minute: m % 60 }).toFormat("h:mm a").replace(":00", "");

export default async function Home() {
  const shopId = await getDefaultShopId().catch(() => null);
  if (!shopId) return <main className="mx-auto max-w-md p-6">This shop isn’t set up yet.</main>;
  const [shop] = await query("SELECT name, address, phone FROM shops WHERE id=$1", [shopId]);
  const services = await query("SELECT id, name, description, duration_min, price FROM services WHERE shop_id=$1 AND active ORDER BY sort_order, name", [shopId]);
  const hours = await query(
    `SELECT r.weekday, min(r.start_minute) AS s, max(r.end_minute) AS e FROM availability_rules r
       JOIN barbers b ON b.id=r.barber_id WHERE b.shop_id=$1 AND b.active GROUP BY r.weekday ORDER BY r.weekday`,
    [shopId],
  );
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">{shop.name}</p>
      <h1 className="mt-2 text-3xl font-bold">Book your appointment</h1>
      <p className="mt-2 text-gray-600">Pick a service, choose a time, done. No account needed.</p>
      <Link href="/book" className="btn-primary mt-6 w-full">Book now</Link>

      <section className="card mt-8" aria-labelledby="loc">
        <h2 id="loc" className="font-semibold">Location &amp; hours</h2>
        <p className="mt-1 text-sm text-gray-700">{shop.address}</p>
        {shop.phone && <p className="text-sm"><a className="underline" href={`tel:${shop.phone}`}>{shop.phone}</a></p>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {hours.map((h) => (
            <div key={h.weekday} className="contents">
              <dt className="font-medium">{DAYS[h.weekday]}</dt>
              <dd>{fmt(h.s)} – {fmt(h.e)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="svc">
        <h2 id="svc" className="mb-3 font-semibold">Services</h2>
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id} className="card flex items-center justify-between">
              <span><span className="font-medium">{s.name}</span><span className="block text-sm text-gray-600">{s.duration_min} min</span></span>
              <span className="font-semibold">${Number(s.price).toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </section>
      <footer className="mt-10 flex gap-4 text-xs text-gray-600">
        <Link href="/privacy" className="underline">Privacy</Link>
        <Link href="/terms" className="underline">Terms &amp; cancellation</Link>
      </footer>
    </main>
  );
}
