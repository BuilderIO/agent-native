import BookingPage from "@/pages/BookingPage";

export function meta() {
  return [{ title: "Book a Meeting" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

// Public booking page — no AppLayout wrapper.
// Future: add a server loader here for og tags/SEO when needed.
export default function BookingRoute() {
  return <BookingPage />;
}
