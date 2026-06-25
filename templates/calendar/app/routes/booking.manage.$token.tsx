import { messagesByLocale } from "@/i18n-data";
import { ManageBookingPage } from "@/pages/ManageBookingPage";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.manageBooking }];
}

// Public page — no AppLayout wrapper
export default function ManageBookingRoute() {
  return <ManageBookingPage />;
}
