import { Outlet } from "react-router";

import enUSMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enUSMessages.routeTitles.bookingLinks }];
}

export default function BookingLinksLayout() {
  return <Outlet />;
}
