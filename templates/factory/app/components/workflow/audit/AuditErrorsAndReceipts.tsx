import { useLocale } from "@agent-native/core/client/i18n";

import { Badge } from "@/components/ui/badge";

import { useItemsStrings } from "../items-strings";
import { errorDetail } from "../items/event-summary";
import { formatDateTime, shortId } from "../items/format";
import { ReceiptLink } from "../items/journey/ReceiptLink";
import type { NodeAudit } from "../items/read-types";

export function AuditErrors({
  errors,
  onOpenItem,
}: {
  errors: NodeAudit["errors"];
  onOpenItem: (itemId: string) => void;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  if (errors.byCode.length === 0 && errors.recentItemErrors.length === 0) {
    return <p className="text-sm text-muted-foreground">{s.audit.noErrors}</p>;
  }
  return (
    <div className="space-y-3">
      {errors.byCode.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {errors.byCode.map((error) => (
            <li key={error.code} className="space-y-0.5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-medium text-destructive">
                  {error.code}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.audit.errorSteps(error.steps)}
                </span>
              </div>
              <p className="line-clamp-3 break-words text-xs">
                {error.lastMessage}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(error.lastAt, locale)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {errors.recentItemErrors.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">{s.audit.itemErrorsHeading}</p>
          <ul className="-mx-2">
            {errors.recentItemErrors.map((error) => (
              <li key={`${error.runId}:${error.itemId}:${error.at}`}>
                <button
                  type="button"
                  onClick={() => onOpenItem(error.itemId)}
                  className="w-full rounded-md px-2 py-1.5 text-start transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-xs">
                      {shortId(error.itemId, 28)}
                    </span>
                    {error.code ? (
                      <span className="shrink-0 font-mono text-xs font-medium text-destructive">
                        {error.code}
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {errorDetail(error.summary, error.code)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AuditReceipts({
  audit,
  onOpenItem,
}: {
  audit: Pick<
    NodeAudit,
    "receipts" | "receiptsTruncated" | "missingReceiptKeys"
  >;
  onOpenItem: (itemId: string) => void;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  const { receipts, receiptsTruncated, missingReceiptKeys } = audit;
  return (
    <div className="space-y-2">
      {receipts.length === 0 && missingReceiptKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s.audit.noReceipts}</p>
      ) : null}
      {receipts.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {receipts.map((receipt) => (
            <li key={receipt.key} className="space-y-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <ReceiptLink receipt={receipt} />
                <Badge
                  variant={
                    receipt.status === "failed" ? "destructive" : "outline"
                  }
                  className="shrink-0"
                >
                  {s.journey.receiptState[receipt.status]}
                </Badge>
              </div>
              {receipt.summary ? (
                <p className="break-words text-xs text-muted-foreground">
                  {receipt.summary}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(receipt.at, locale)}</span>
                <button
                  type="button"
                  onClick={() => onOpenItem(receipt.itemId)}
                  className="font-mono underline underline-offset-2 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  aria-label={s.audit.openItem}
                >
                  {shortId(receipt.itemId, 18)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {receiptsTruncated ? (
        <p className="text-xs text-muted-foreground">
          {s.audit.receiptsTruncated}
        </p>
      ) : null}
      {missingReceiptKeys.length > 0 ? (
        <p className="text-xs text-destructive">
          {s.audit.missingReceipts(missingReceiptKeys.length)}
        </p>
      ) : null}
    </div>
  );
}
