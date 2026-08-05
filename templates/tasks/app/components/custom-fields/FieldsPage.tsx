import { useT } from "@agent-native/core/client/i18n";
import { useCallback } from "react";
import { useSearchParams } from "react-router";

import { FieldsList } from "@/components/custom-fields/FieldsList";
import { PageHeader } from "@/components/shared/PageHeader";

export function FieldsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFieldId = searchParams.get("field");

  const setActiveFieldId = useCallback(
    (nextFieldId: string | null) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (nextFieldId) {
            nextParams.set("field", nextFieldId);
          } else {
            nextParams.delete("field");
          }
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-6 overflow-hidden p-4 md:p-6">
      <PageHeader
        title={t("fields.pageTitle")}
        description={t("fields.pageDescription")}
      />

      <FieldsList
        activeFieldId={activeFieldId}
        setActiveFieldId={setActiveFieldId}
      />
    </div>
  );
}
