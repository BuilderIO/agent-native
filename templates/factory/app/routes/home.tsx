import { Navigate } from "react-router";

export function meta() {
  return [
    { title: "Factories" },
    { name: "description", content: "Review and manage your agent factories." },
  ];
}

// Private app entry retained at /home; / redirects to shared sign-in/signup.
export default function IndexRoute() {
  return <Navigate to="/factory" replace />;
}
