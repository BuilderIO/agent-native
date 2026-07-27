import { Outlet } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.bookingLinks }];
}

export default function BookingLinksLayout() {
  return <Outlet />;
}
