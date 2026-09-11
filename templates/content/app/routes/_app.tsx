import { Outlet } from "react-router";

import { Layout } from "@/components/layout/Layout";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  const title = messagesByLocale["en-US"].root.metaTitle;
  const description = messagesByLocale["en-US"].root.metaDescription;

  return [
    { title },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

// Pathless layout route — wraps all protected routes with Layout so the
// agent sidebar and document tree persist across client-side navigations.
export default function AppLayoutRoute() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
