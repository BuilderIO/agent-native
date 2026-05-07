import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Extensions - Images" }];
}

export default function ExtensionsLayout() {
  return <Outlet />;
}
