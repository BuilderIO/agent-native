import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Extensions — Design" }];
}

export default function ExtensionsLayout() {
  return <Outlet />;
}
