import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Library - Assets" }];
}

// Legacy Brand Kits routes now redirect into the unified Library workspace.
export default function BrandKitsLayout() {
  return <Outlet />;
}
