import { redirect } from "react-router";

// Landing → dashboard. Auth is enforced by the `_app` layout; unauthenticated
// users get redirected to the login flow from there.
export function loader() {
  return redirect("/event-types");
}

export default function Index() {
  return null;
}
