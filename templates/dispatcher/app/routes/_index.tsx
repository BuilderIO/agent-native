import { Navigate } from "react-router";

export function meta() {
  return [{ title: "Dispatcher" }];
}

export default function IndexPage() {
  return <Navigate to="/overview" replace />;
}
