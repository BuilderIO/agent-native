import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Booking Links — Calendar" }];
}

export default function BookingLinksLayout() {
  return <Outlet />;
}
