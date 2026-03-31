import { ManageBookingPage } from "@/pages/ManageBookingPage";

export function meta() {
  return [{ title: "Manage Booking" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

// Public page — no AppLayout wrapper
export default function ManageBookingRoute() {
  return <ManageBookingPage />;
}
