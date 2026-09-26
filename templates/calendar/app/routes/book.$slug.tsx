import BookingPage from "@/pages/BookingPage";

import { bookingOgLoader, bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

export default function BookingRoute() {
  return <BookingPage />;
}
