import { BookingsPanel } from "./bookings/BookingsPanel";

export default function Today() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Today</h1>
      <BookingsPanel mode="today" />
    </>
  );
}
