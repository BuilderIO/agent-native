import { Navigate } from "react-router";

export default function FromContentRoute() {
  return <Navigate replace to="/library?source=content" />;
}
