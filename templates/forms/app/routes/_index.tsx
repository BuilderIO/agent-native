import { redirect } from "react-router";
import type { Route } from "./+types/_index";

export function meta() {
  return [
    { title: "Agent-Native Forms" },
    {
      name: "description",
      content:
        "Your AI agent builds, publishes, and analyzes forms alongside you.",
    },
  ];
}

export function loader({}: Route.LoaderArgs) {
  return redirect("/forms");
}

export default function Index() {
  return null;
}
