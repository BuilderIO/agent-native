import { bookingOgLoader } from "@/lib/booking-og-loader.server";
import BookingPage from "@/pages/BookingPage";

import { bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

export default function BookingRoute() {
  return <BookingPage />;
}
