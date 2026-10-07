import { query } from "@/lib/db";
import { json, route, limit } from "@/lib/api";
import { getDefaultShopId } from "@/lib/slots";

export const GET = route(async () => {
  const shopId = await getDefaultShopId();
  const rows = await query(
    `SELECT id, name, description, duration_min AS "durationMin", price FROM services
      WHERE shop_id=$1 AND active ORDER BY sort_order, name`,
    [shopId],
  );
  return json({ services: rows });
});
