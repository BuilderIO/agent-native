import { ManageBookingPage } from "@/pages/ManageBookingPage";

export function meta() {
  return [{ title: "Manage Booking" }];
}

// Public page — no AppLayout wrapper
export default function ManageBookingRoute() {
  return <ManageBookingPage />;
}
