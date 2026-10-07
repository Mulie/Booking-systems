import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">We couldn’t find that page</h1>
      <p className="mt-2 text-gray-600">If you’re looking for an appointment, use the link in your confirmation email.</p>
      <Link href="/" className="btn-primary mt-6">Go to booking</Link>
    </main>
  );
}
