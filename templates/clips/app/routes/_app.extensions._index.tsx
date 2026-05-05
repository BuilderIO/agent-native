import { ExtensionsListPage } from "@agent-native/core/client/extensions";
import { PageHeader } from "@/components/library/page-header";

export default function ExtensionsRoute() {
  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Extensions
        </h1>
      </PageHeader>
      <ExtensionsListPage />
    </>
  );
}
