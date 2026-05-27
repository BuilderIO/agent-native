import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Extensions - Assets" }];
}

export default function ExtensionsLayout() {
  return <Outlet />;
}
