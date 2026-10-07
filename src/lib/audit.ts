import { query } from "./db";
import type { Session } from "./auth";

export async function audit(s: Session, action: string, entity: string, entityId: string | null, detail: object = {}) {
  await query("INSERT INTO audit_log(shop_id,user_id,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6)", [
    s.shopId, s.uid, action, entity, entityId, JSON.stringify(detail),
  ]);
}
