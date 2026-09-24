/**
 * Record header: identity, provenance, the upstream deep link, quick actions.
 */

import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CrmRecordDetail } from "@/lib/types";

const PROVIDER_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
};

export function RecordHeader({
  record,
  recordUrl,
  recordUrlUnavailableReason,
  actions,
}: {
  record: CrmRecordDetail;
  recordUrl: string | null;
  recordUrlUnavailableReason: string | null;
  actions?: React.ReactNode;
}) {
  const t = useT();
  const providerLabel = record.provider
    ? PROVIDER_LABELS[record.provider]
    : undefined;

  return (
    /* 104px: the record header's fixed band. `min-h` rather than `h` so a
       wrapped title or a second row of badges grows it instead of clipping. */
    <header className="flex min-h-[6.5rem] items-center border-b border-hairline px-5 py-4 sm:px-6">
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <RecordAvatar name={record.displayName} kind={record.kind} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {record.displayName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-content-secondary">
              <span className="capitalize">{record.kind}</span>
              {record.stage ? (
                <Badge variant="secondary" className="font-normal">
                  {record.stage}
                </Badge>
              ) : null}
              {providerLabel ? (
                <Badge variant="outline" className="font-normal">
                  {t("record.mirroredFrom", { provider: providerLabel })}
                </Badge>
              ) : null}
              {record.owner ? (
                <span>{t("record.ownedBy", { owner: record.owner })}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A native record has no upstream record at all, so it shows no link
              and no "unavailable" note — absent and unavailable are different. */}
          {providerLabel && recordUrl ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={recordUrl} target="_blank" rel="noopener noreferrer">
                {t("record.openUpstream", { provider: providerLabel })}
                <IconExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
          {providerLabel && !recordUrl && recordUrlUnavailableReason ? (
            <span className="text-xs text-content-tertiary">
              {t("record.upstreamLinkUnavailable", {
                provider: providerLabel,
                reason: recordUrlUnavailableReason,
              })}
            </span>
          ) : null}
          {actions}
        </div>
      </div>
    </header>
  );
}

function RecordAvatar({ name, kind }: { name: string; kind: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  // Person avatars are circles, company avatars a 30% squircle — the shape is
  // how the two record kinds stay distinguishable at a glance.
  return (
    <div
      aria-hidden
      className={`grid size-10 shrink-0 place-items-center bg-muted text-sm font-medium uppercase text-content-secondary ring-1 ring-inset ring-hairline ${
        kind === "person" ? "rounded-full" : "rounded-avatar-company"
      }`}
    >
      {initials || "?"}
    </div>
  );
}
