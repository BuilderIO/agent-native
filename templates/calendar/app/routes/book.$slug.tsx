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

// Public booking page — no AppLayout wrapper.
// Future: add a server loader here for og tags/SEO when needed.
export default function BookingRoute() {
  return <BookingPage />;
}
