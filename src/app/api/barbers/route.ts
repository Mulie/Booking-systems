import { z } from "zod";
import { query } from "@/lib/db";
import { json, route } from "@/lib/api";
import { getDefaultShopId } from "@/lib/slots";

export const GET = route(async (req: Request) => {
  const shopId = await getDefaultShopId();
  const serviceId = z.string().uuid().optional().parse(new URL(req.url).searchParams.get("serviceId") ?? undefined);
  const rows = await query(
    `SELECT b.id, b.display_name AS name, b.photo_url AS "photoUrl" FROM barbers b
      WHERE b.shop_id=$1 AND b.active
        AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM barber_services bs JOIN services s ON s.id=bs.service_id
                                          WHERE bs.barber_id=b.id AND bs.service_id=$2 AND bs.active AND s.active))
      ORDER BY b.display_name`,
    [shopId, serviceId ?? null],
  );
  return json({ barbers: rows });
});
