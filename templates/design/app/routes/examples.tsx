import { redirect } from "react-router";

export function loader() {
  return redirect("/templates", 301);
}

export function meta() {
  return [{ title: "Design Templates" }];
}

export default function ExamplesRedirect() {
  return null;
}
