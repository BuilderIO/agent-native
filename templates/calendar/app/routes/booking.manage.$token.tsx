import enUSMessages from "@/i18n/en-US";
import { ManageBookingPage } from "@/pages/ManageBookingPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.manageBooking }];
}

export default function ManageBookingRoute() {
  return <ManageBookingPage />;
}
