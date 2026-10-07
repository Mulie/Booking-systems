import { BookingsPanel } from "./BookingsPanel";

export default function Bookings() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Bookings</h1>
      <BookingsPanel mode="all" />
    </>
  );
}
