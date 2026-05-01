import { redirect } from "react-router";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [
    { title: "Agent-Native Mail" },
    {
      name: "description",
      content:
        "Your AI agent reads, drafts, and organizes email alongside you.",
    },
  ];
}

/**
 * Run the redirect on both the server and the client. Doing it client-only
 * via `clientLoader` previously caused React Router to occasionally log
 * `No routes matched location "/inbox"` because the navigation fired during
 * hydration, before the route tree was fully attached. A `loader` runs as
 * part of the server response and the navigation completes before the app
 * hydrates.
 */
export function loader() {
  throw redirect("/inbox");
}

export function clientLoader() {
  throw redirect("/inbox");
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8" />
    </div>
  );
}

export default function IndexRoute() {
  // Should never render — both loader and clientLoader redirect to /inbox.
  return null;
}
