import { Outlet } from "react-router";

import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.brandKits }];
}

// Layout for the Brand Kits section. The list lives in `brand-kits._index.tsx`
// and a single kit's detail lives in `brand-kits.$id.tsx`; both render through
// this `<Outlet/>`. Without this layout, flat-routes nests the `$id` detail
// under the list page, which has no Outlet, so `/brand-kits/:id` rendered the
// list instead of the detail (kits looked unviewable / uneditable).
export default function BrandKitsLayout() {
  return <Outlet />;
}
