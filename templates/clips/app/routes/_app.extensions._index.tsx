import { useT } from "@agent-native/core/client";
import { ExtensionsListPage } from "@agent-native/core/client/extensions";

import { PageHeader } from "@/components/library/page-header";

export default function ExtensionsRoute() {
  const t = useT();

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("navigation.extensions")}
        </h1>
      </PageHeader>
      <ExtensionsListPage />
    </>
  );
}
