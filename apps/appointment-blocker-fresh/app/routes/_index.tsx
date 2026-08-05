import { redirect } from "react-router";

export function loader() {
  return redirect("/workflow");
}

export default function IndexRoute() {
  return null;
}
