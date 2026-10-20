import { Outlet } from "react-router";

import { Layout } from "@/components/layout/Layout";

export default function AppLayoutRoute() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
