import { redirect } from "react-router";
export function loader() {
  return redirect("/event-types");
}
export default function AppIndex() {
  return null;
}
