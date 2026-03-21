import BookingsList from "@/pages/BookingsList";
import { AppLayout } from "@/components/layout/AppLayout";

export function meta() {
  return [{ title: "Bookings — Calendar" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function BookingsRoute() {
  return (
    <AppLayout>
      <BookingsList />
    </AppLayout>
  );
}
