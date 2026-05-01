import { redirect } from "react-router";

export function meta() {
  return [
    { title: "Agent-Native Scheduling" },
    {
      name: "description",
      content:
        "Your AI agent manages availability, books meetings, and handles rescheduling alongside you.",
    },
  ];
}

// Landing → dashboard. Auth is enforced by the `_app` layout; unauthenticated
// users get redirected to the login flow from there.
export function loader() {
  return redirect("/event-types");
}

export default function Index() {
  return null;
}
