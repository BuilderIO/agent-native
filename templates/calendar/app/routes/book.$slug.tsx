import BookingPage from "@/pages/BookingPage";
import { Spinner } from "@/components/ui/spinner";
import { bookingOgLoader, bookingOgMeta } from "./booking-og-meta";

export const loader = bookingOgLoader;

export const meta = bookingOgMeta;

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

// Public booking page — no AppLayout wrapper.
export default function BookingRoute() {
  return <BookingPage />;
}
