import { Outlet } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.brandKits }];
}

// Legacy Brand Kits routes now redirect into the unified Library workspace.
export default function BrandKitsLayout() {
  return <Outlet />;
}
