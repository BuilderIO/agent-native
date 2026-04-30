import { redirect, type LoaderFunctionArgs } from "react-router";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Issues" }];
}

/**
 * Run the redirect on both the server and the client. A client-only
 * `<Navigate>` can drop during hydration (before the route tree is fully
 * attached), leaving the user stranded on `/` with a blank main area while
 * the layout chrome around it still renders. A `loader` redirect runs as
 * part of the server response and the navigation completes before the app
 * hydrates; `clientLoader` covers SPA-style navigations to `/`.
 */
function buildTarget(request: Request): string {
  const url = new URL(request.url);
  return `/my-issues${url.search}${url.hash}`;
}

export function loader({ request }: LoaderFunctionArgs) {
  throw redirect(buildTarget(request));
}

export function clientLoader({ request }: LoaderFunctionArgs) {
  throw redirect(buildTarget(request));
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8" />
    </div>
  );
}

export default function Index() {
  return null;
}
