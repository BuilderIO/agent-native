import { ManageBookingPage } from "@/pages/ManageBookingPage";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Manage Booking" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

// Public page — no AppLayout wrapper
export default function ManageBookingRoute() {
  return <ManageBookingPage />;
}
