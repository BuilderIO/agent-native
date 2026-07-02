import { useT } from "@agent-native/core/client";
import { DbAdminPage } from "@agent-native/core/client/db-admin";

import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Database" }];
}

export default function DatabasePage() {
  const t = useT();
  useSetPageTitle(t("pages.databaseTitle"));
  return (
    <div className="h-full">
      <DbAdminPage />
    </div>
  );
}
