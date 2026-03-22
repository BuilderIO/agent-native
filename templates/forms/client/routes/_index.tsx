import { redirect } from "react-router";
import type { Route } from "./+types/_index";

export function loader({}: Route.LoaderArgs) {
  return redirect("/forms");
}

export default function Index() {
  return null;
}
