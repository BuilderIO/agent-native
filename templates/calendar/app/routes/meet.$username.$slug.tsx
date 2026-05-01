import BookingPage from "@/pages/BookingPage";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Book a Meeting" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

// Legacy public booking page. BookingPage canonicalizes this to /book/:username/:slug.
export default function MeetBookingRoute() {
  return <BookingPage />;
}
