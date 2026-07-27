import { redirect, type LoaderFunctionArgs } from "react-router";

// `/adhoc/:id` is the legacy dashboard URL. The canonical, user-facing URL is
// now `/dashboards/:id`. Forward old links (bookmarks, deep links, query
// params like `?id=` and `?config=`) to the canonical path so nothing breaks.
function target({ params, url }: LoaderFunctionArgs): string {
  const id = params.id ?? "";
  return `/dashboards/${encodeURIComponent(id)}${url.search}${url.hash}`;
}

export function loader(args: LoaderFunctionArgs) {
  throw redirect(target(args));
}

export function clientLoader(args: LoaderFunctionArgs) {
  throw redirect(target(args));
}

export default function AdhocRedirectRoute() {
  return null;
}
