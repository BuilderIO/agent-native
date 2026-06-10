import BookingPage from "@/pages/BookingPage";
import { bookingOgLoader, bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

// Public booking page — no AppLayout wrapper.
export default function BookingRoute() {
  return <BookingPage />;
}
