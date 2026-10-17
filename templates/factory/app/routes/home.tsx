import { Navigate } from "react-router";

export function meta() {
  return [
    { title: "Factories" },
    { name: "description", content: "Review and manage your agent factories." },
  ];
}

export default function IndexRoute() {
  return <Navigate to="/factory" replace />;
}
