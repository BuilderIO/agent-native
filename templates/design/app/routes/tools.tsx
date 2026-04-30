import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Tools — Design" }];
}

export default function ToolsLayout() {
  return <Outlet />;
}
