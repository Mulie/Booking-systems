import { z } from "zod";
import { pool } from "@/lib/db";
import { json, route, limit } from "@/lib/api";
import { getDefaultShopId, publicAvailability } from "@/lib/slots";

const q = z.object({
  serviceId: z.string().uuid(),
  barberId: z.union([z.literal("any"), z.string().uuid()]).default("any"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excludeBookingId: z.string().uuid().optional(),
});

export const GET = route(async (req: Request) => {
  await limit("availability", 60);
  const p = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const shopId = await getDefaultShopId();
  return json(await publicAvailability(pool(), shopId, p.serviceId, p.barberId, p.from, p.to, p.excludeBookingId));
});
