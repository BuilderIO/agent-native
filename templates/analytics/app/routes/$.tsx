import { data } from "react-router";

import { messagesByLocale } from "@/i18n-data";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.notFound }];
}

// The splat route matches every unmatched path, so React Router's "no routes
// matched" 404 branch never fires here and the response defaults to 200. Set
// the status explicitly so the shell is served (and CDN-cached) as the
// not-found page it actually is.
export function loader() {
  return data(null, { status: 404 });
}

export default function CatchAllRoute() {
  return <NotFound />;
}
