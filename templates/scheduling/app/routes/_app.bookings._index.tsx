import { redirect } from "react-router";
export function loader() {
  return redirect("/bookings/upcoming");
}
export default function BookingsIndex() {
  return null;
}
