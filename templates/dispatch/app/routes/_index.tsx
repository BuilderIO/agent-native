import { Navigate, useLocation } from "react-router";

export function meta() {
  return [{ title: "Dispatch" }];
}

export default function IndexPage() {
  // Preserve the query string when bouncing to /overview, otherwise the
  // ?thread=<id> deep-link from a Slack "Open thread" button gets dropped
  // before root.tsx's useThreadDeepLink can read it. Same for ?tab=, etc.
  const location = useLocation();
  const target = `/overview${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}
