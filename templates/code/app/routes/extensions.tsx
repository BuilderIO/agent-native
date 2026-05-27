import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Extensions - Agent-Native Code" }];
}

export default function ExtensionsLayout() {
  return <Outlet />;
}
