import BookingPage from "@/pages/BookingPage";

export function meta() {
  return [{ title: "Book a Meeting" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

// Public booking page at /meet/:username/:slug — no AppLayout wrapper.
export default function MeetBookingRoute() {
  return <BookingPage />;
}
