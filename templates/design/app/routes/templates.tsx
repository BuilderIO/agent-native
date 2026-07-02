import { redirect } from "react-router";

export function loader() {
  return redirect("/", 302);
}

export default function TemplatesRedirect() {
  return null;
}
