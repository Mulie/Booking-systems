import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignOut } from "./SignOut";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff", robots: { index: false, follow: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  const manage = s.role !== "barber";
  const links = [
    ["/admin", "Today"], ["/admin/bookings", "Bookings"], ["/admin/schedule", "Schedule"],
    ...(manage ? [["/admin/services", "Services"], ["/admin/barbers", "Barbers"], ["/admin/settings", "Settings"]] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <nav aria-label="Staff" className="flex flex-wrap gap-1">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white focus-visible:bg-white">{label}</Link>
          ))}
        </nav>
        <SignOut />
      </header>
      {children}
    </div>
  );
}
