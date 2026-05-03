import { redirect } from "react-router";

export function loader() {
  return redirect("/dictate");
}

export default function LegacyWisprRedirect() {
  return null;
}
