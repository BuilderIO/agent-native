import BookingPage from "@/pages/BookingPage";
import { bookingOgLoader, bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

// Public booking page at /book/:username/:slug — no AppLayout wrapper.
export default function UserBookingRoute() {
  return <BookingPage />;
}
