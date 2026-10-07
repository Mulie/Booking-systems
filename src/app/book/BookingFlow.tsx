"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SlotPicker, dateLabel, to12h, type Slot } from "@/components/SlotPicker";

type Service = { id: string; name: string; description: string; durationMin: number; price: string };
type Barber = { id: string; name: string; photoUrl: string | null };
type Step = "service" | "barber" | "time" | "details" | "review";
const ORDER: Step[] = ["service", "barber", "time", "details", "review"];
const TITLES: Record<Step, string> = {
  service: "Choose a service", barber: "Choose a barber", time: "Choose a time", details: "Your details", review: "Review and confirm",
};

export function BookingFlow({ shop }: { shop: { name: string; address: string; policy: string } }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("service");
  const [services, setServices] = useState<Service[] | null>(null);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [barberId, setBarberId] = useState<string>("any");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const idem = useRef<string>("");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    fetch("/api/services").then((r) => r.json()).then((j) => setServices(j.services)).catch(() => setBanner("Couldn't load services. Please refresh."));
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const go = (s: Step) => { setBanner(""); setStep(s); };
  const back = () => { const i = ORDER.indexOf(step); if (i > 0) go(ORDER[i - 1]); };

  const pickService = async (s: Service) => {
    setService(s); setSlot(null); setBarberId("any");
    const r = await fetch(`/api/barbers?serviceId=${s.id}`);
    const j = await r.json();
    setBarbers(j.barbers);
    go("barber");
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Enter your name";
    if (!/^\+?[\d\s().-]{7,20}$/.test(form.phone.trim())) e.phone = "Enter a valid mobile number";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email or leave it blank";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const confirm = useCallback(async () => {
    if (!service || !slot || busy) return;
    setBusy(true); setBanner("");
    if (!idem.current) idem.current = crypto.randomUUID();
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          barberId,
          startsAt: slot.startsAt,
          customer: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() },
          idempotencyKey: idem.current,
          website: form.website,
        }),
      });
      const j = await r.json();
      if (r.status === 201) return router.push(j.manageUrl + "&new=1");
      idem.current = ""; // a failed attempt must not be replayed under the same key
      if (r.status === 409) {
        setSlot(null); setRefresh((n) => n + 1); setStep("time");
        setBanner("That time was just booked. Here are the latest available times.");
      } else setBanner(j.error?.message ?? "Something went wrong. Please try again.");
    } catch {
      setBanner("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [service, slot, barberId, form, busy, router]);

  const stepNo = ORDER.indexOf(step) + 1;
  const chosenBarber = barberId === "any" ? "Any available barber" : barbers.find((b) => b.id === barberId)?.name;

  return (
    <main className="mx-auto max-w-md px-4 pb-24 pt-6">
      <header className="mb-4 flex items-center justify-between">
        {step !== "service" ? <button onClick={back} className="btn-secondary min-h-[44px] px-3" aria-label="Back">← Back</button> : <span />}
        <span className="text-sm text-gray-600" aria-label={`Step ${stepNo} of 5`}>Step {stepNo} of 5</span>
      </header>
      <div className="mb-5 h-1.5 overflow-hidden rounded bg-gray-200" aria-hidden><div className="h-full bg-amber-700 transition-all" style={{ width: `${stepNo * 20}%` }} /></div>

      <h1 ref={heading} tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">{TITLES[step]}</h1>
      {banner && <p role="alert" className="err mb-4">{banner}</p>}

      {step !== "service" && service && step !== "review" && (
        <p className="mb-4 text-sm text-gray-700">{service.name} · {service.durationMin} min · ${Number(service.price).toFixed(2)}</p>
      )}

      {step === "service" && (
        services === null ? <p className="text-gray-600">Loading…</p> : (
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id}>
                <button className="choice" onClick={() => pickService(s)}>
                  <span><span className="block font-semibold">{s.name}</span>
                    {s.description && <span className="block text-sm text-gray-600">{s.description}</span>}
                    <span className="block text-sm text-gray-600">{s.durationMin} min</span></span>
                  <span className="text-lg font-semibold">${Number(s.price).toFixed(0)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {step === "barber" && (
        <ul className="space-y-2">
          <li><button className="choice" onClick={() => { setBarberId("any"); setSlot(null); go("time"); }}>
            <span><span className="block font-semibold">Any available barber</span><span className="block text-sm text-gray-600">Most appointment times</span></span></button></li>
          {barbers.map((b) => (
            <li key={b.id}><button className="choice justify-start" onClick={() => { setBarberId(b.id); setSlot(null); go("time"); }}>
              {b.photoUrl ? <img src={b.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> :
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 font-semibold">{b.name[0]}</span>}
              <span className="font-semibold">{b.name}</span></button></li>
          ))}
        </ul>
      )}

      {step === "time" && service && (
        <>
          <SlotPicker serviceId={service.id} barberId={barberId} selected={slot?.startsAt ?? null} refreshKey={refresh}
            onSelect={(s) => { setSlot(s); }} />
          <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4"><div className="mx-auto max-w-md">
            <button className="btn-primary w-full" disabled={!slot} onClick={() => go("details")}>Continue</button></div></div>
        </>
      )}

      {step === "details" && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (validate()) go("review"); }} className="space-y-4">
          <p className="text-sm text-gray-600">We use your contact details only to confirm or change this appointment.</p>
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-err" : undefined} />
            {errors.name && <p id="name-err" role="alert" className="mt-1 text-sm text-red-700">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="phone" className="label">Mobile number</label>
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "phone-err" : undefined} />
            {errors.phone && <p id="phone-err" role="alert" className="mt-1 text-sm text-red-700">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor="email" className="label">Email <span className="font-normal text-gray-600">(optional, for your confirmation)</span></label>
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-err" : undefined} />
            {errors.email && <p id="email-err" role="alert" className="mt-1 text-sm text-red-700">{errors.email}</p>}
          </div>
          {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
          <div aria-hidden className="absolute -left-[9999px]"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label></div>
          <button className="btn-primary w-full" type="submit">Review appointment</button>
        </form>
      )}

      {step === "review" && service && slot && (
        <div className="space-y-4">
          <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-gray-600">Service</dt><dd className="font-semibold">{service.name} ({service.durationMin} min)</dd>
            <dt className="text-gray-600">Barber</dt><dd className="font-semibold">{barberId === "any" ? `${slot.barberName} (any available)` : chosenBarber}</dd>
            <dt className="text-gray-600">When</dt><dd className="font-semibold">{slot.date ? `${dateLabel(slot.date).long}, ${to12h(slot.start)}` : to12h(slot.start)}</dd>
            <dt className="text-gray-600">Price</dt><dd className="font-semibold">${Number(service.price).toFixed(2)} <span className="font-normal text-gray-600">(pay at the shop)</span></dd>
            <dt className="text-gray-600">Where</dt><dd>{shop.name}<br />{shop.address}</dd>
            <dt className="text-gray-600">For</dt><dd>{form.name}<br />{form.phone}{form.email && <><br />{form.email}</>}</dd>
          </dl>
          <p className="rounded-lg bg-amber-50 p-3 text-sm"><strong>Cancellation policy:</strong> {shop.policy}</p>
          <button className="btn-primary w-full" onClick={confirm} disabled={busy}>{busy ? "Booking…" : "Confirm appointment"}</button>
        </div>
      )}
    </main>
  );
}
