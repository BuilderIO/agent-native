import { Navigate } from "react-router";

// The framework's default post-sign-in landing; Forms keeps its home at "/".
export default function HomeRedirect() {
  return <Navigate to="/" replace />;
}
