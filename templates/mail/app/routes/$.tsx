import { data } from "react-router";

import messages from "@/i18n/en-US";
import { NotFound } from "@/pages/NotFound";

export function meta() {
  return [{ title: messages.mail.routeTitles.notFound }];
}

// The splat route matches every unmatched path, so React Router's "no routes
// matched" 404 branch never fires here and the response defaults to 200. Set
// the status explicitly so an unknown URL is served as the 404 it actually is.
export function loader() {
  return data(null, { status: 404 });
}

export default function CatchAllRoute() {
  return <NotFound />;
}
