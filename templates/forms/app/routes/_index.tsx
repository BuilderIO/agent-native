import { redirect } from "react-router";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
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
  const appBasePath = getConfiguredAppBasePath();
  return redirect(appBasePath ? `${appBasePath}/forms` : "/forms");
}

export default function Index() {
  return null;
}
