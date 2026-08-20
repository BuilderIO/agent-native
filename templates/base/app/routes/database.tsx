import { DbAdminPage } from "@agent-native/core/client/db-admin";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

export function meta() {
  return [{ title: "Database" }];
}

export default function DatabasePage() {
  useSetPageTitle("Database");
  return (
    <div className="h-full">
      <DbAdminPage />
    </div>
  );
}
