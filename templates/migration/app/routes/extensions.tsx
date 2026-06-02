import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Extensions - Migration" }];
}

export default function ExtensionsLayout() {
  return <Outlet />;
}
