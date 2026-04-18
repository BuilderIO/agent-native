import { redirect } from "react-router";
export function loader() {
  return redirect("/settings/my-account/profile");
}
export default function SettingsIndex() {
  return null;
}
