import { Navigate } from "react-router";

export function meta() {
  return [{ title: "Team" }];
}

export default function TeamRoute() {
  return <Navigate to="/settings#organization" replace />;
}
