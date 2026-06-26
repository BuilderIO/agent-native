import { Navigate } from "react-router";

export function meta() {
  return [{ title: "Team — Dispatch" }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#team" replace />;
}
