import { query } from "@/lib/db";
import { getDefaultShopId } from "@/lib/slots";
import { BookingFlow } from "./BookingFlow";

export const metadata = { title: "Book your appointment" };
export const dynamic = "force-dynamic";

export default async function BookPage() {
  const shopId = await getDefaultShopId();
  const [shop] = await query(
    `SELECT name, address, cancellation_policy AS policy FROM shops WHERE id=$1`, [shopId]);
  return <BookingFlow shop={shop} />;
}
