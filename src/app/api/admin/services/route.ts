import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { serviceSchema } from "@/lib/schemas";


export const GET = route(async () => {
  const s = await requireAdmin();
  const rows = await query(
    `SELECT id, name, description, duration_min AS "durationMin", buffer_min AS "bufferMin", price::float8 AS price, active, sort_order AS "sortOrder"
       FROM services WHERE shop_id=$1 ORDER BY active DESC, sort_order, name`,
    [s.shopId],
  );
  return json({ services: rows });
});

export const POST = route(async (req: Request) => {
  const s = await requireAdmin({ manage: true, mutating: true });
  const d = await body(req, serviceSchema);
  const r = await query(
    `INSERT INTO services(shop_id,name,description,duration_min,buffer_min,price,active,sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [s.shopId, d.name, d.description, d.durationMin, d.bufferMin, d.price, d.active, d.sortOrder],
  );
  // New services are offered by all active barbers by default; adjust under Barbers.
  await query(
    "INSERT INTO barber_services(barber_id, service_id) SELECT id, $1 FROM barbers WHERE shop_id=$2 AND active ON CONFLICT DO NOTHING",
    [r[0].id, s.shopId],
  );
  await audit(s, "service.create", "service", r[0].id, d);
  return json({ id: r[0].id }, 201);
});
