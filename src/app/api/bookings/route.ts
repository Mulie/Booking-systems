import { z } from "zod";
import { after } from "next/server";
import { body, json, limit, route } from "@/lib/api";
import { createBooking, publicBooking } from "@/lib/booking";
import { getDefaultShopId } from "@/lib/slots";
import { runDueJobs } from "@/lib/jobs";

const schema = z.object({
  serviceId: z.string().uuid(),
  barberId: z.union([z.literal("any"), z.string().uuid()]),
  startsAt: z.string().datetime({ offset: true }),
  customer: z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().regex(/^\+?[\d\s().-]{7,20}$/, "Enter a valid phone number"),
    email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  }),
  idempotencyKey: z.string().min(8).max(100).optional(),
  website: z.string().max(0).optional(), // honeypot: real users never fill this
});

export const POST = route(async (req: Request) => {
  await limit("booking", 10);
  const d = await body(req, schema);
  if (d.website) return json({ error: { code: "400", message: "Invalid input" } }, 400);
  const shopId = await getDefaultShopId();
  const b = await createBooking({
    shopId,
    serviceId: d.serviceId,
    barberId: d.barberId,
    startsAt: new Date(d.startsAt),
    customer: d.customer,
    idempotencyKey: d.idempotencyKey,
  });
  after(() => runDueJobs().catch((e) => console.error("job run failed", e)));
  return json({ booking: publicBooking(b), manageToken: b.manageToken, manageUrl: `/booking/${b.id}?token=${b.manageToken}` }, 201);
});
