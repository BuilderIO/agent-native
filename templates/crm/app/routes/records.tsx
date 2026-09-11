import { useT } from "@agent-native/core/client/i18n";
import { useSearchParams } from "react-router";

import { CreateCrmRecordDialog } from "@/components/crm/CreateCrmRecordDialog";
import { RecordGrid } from "@/components/crm/RecordGrid";
import { PageHeader } from "@/components/crm/Surface";
import type { CrmKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: CrmKind[] = ["account", "person", "opportunity"];

export function meta() {
  return [{ title: "Records · CRM" }]; // i18n-ignore
}

export default function RecordsRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("kind");
  const kind: CrmKind = KINDS.includes(raw as CrmKind)
    ? (raw as CrmKind)
    : "account";

  function selectKind(next: CrmKind) {
    const updated = new URLSearchParams(params);
    updated.set("kind", next);
    // A cursor and a search term belong to the kind that produced them.
    updated.delete("q");
    setParams(updated, { replace: true });
  }

  return (
    <>
      <PageHeader
        eyebrow={t("records.eyebrow")}
        title={t("records.title")}
        description={t("records.description")}
        actions={<CreateCrmRecordDialog kind={kind} />}
      />
      <div className="flex items-center gap-1 border-b border-border/70 px-5 py-2">
        {KINDS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => selectKind(candidate)}
            className={cn(
              "cursor-pointer rounded-full px-3 py-1 text-sm transition-colors",
              candidate === kind
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`records.kind.${candidate}`)}
          </button>
        ))}
      </div>
      <RecordGrid
        key={kind}
        kind={kind}
        emptyTitle={t(`records.empty.${kind}`)}
      />
    </>
  );
}
