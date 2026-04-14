import { Navigate } from "react-router";

export function meta() {
  return [{ title: "Dispatch" }];
}

export default function IndexPage() {
  return <Navigate to="/overview" replace />;
}
