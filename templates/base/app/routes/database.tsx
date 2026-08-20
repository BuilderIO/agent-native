import { DbAdminPage } from "@agent-native/core/client/db-admin";

export function meta() {
  return [{ title: "Database" }];
}

export default function DatabasePage() {
  return (
    <div className="p-6">
      <DbAdminPage />
    </div>
  );
}
