import BookingPage from "@/pages/BookingPage";

import { bookingOgLoader, bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

// Legacy public booking page. BookingPage canonicalizes this to /book/:username/:slug.
export default function MeetBookingRoute() {
  return <BookingPage />;
}
