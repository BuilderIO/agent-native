import { useLocale } from "@agent-native/core/client/i18n";

import { Badge } from "@/components/ui/badge";

import { useItemsStrings } from "../../items-strings";
import { formatDateTime } from "../format";
import type { PathNode, ReceiptView } from "../read-types";
import { ReceiptLink } from "./ReceiptLink";

export function JourneyReceipts({
  receipts,
  truncated,
  path,
}: {
  receipts: readonly ReceiptView[];
  truncated: boolean;
  path: readonly PathNode[];
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  const nodeName = new Map(path.map((node) => [node.nodeId, node.nodeName]));
  return (
    <section aria-labelledby="journey-receipts" className="space-y-2">
      <h3 id="journey-receipts" className="text-sm font-semibold">
        {s.journey.receiptsHeading}
      </h3>
      {receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s.journey.noReceipts}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {receipts.map((receipt) => (
            <li
              key={receipt.key}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">
                  {nodeName.get(receipt.nodeId) ?? receipt.nodeId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(receipt.at, locale)}
                </p>
                {receipt.summary ? (
                  <p className="break-words text-xs text-muted-foreground">
                    {receipt.summary}
                  </p>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
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
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          {s.journey.receiptsTruncated(receipts.length)}
        </p>
      ) : null}
    </section>
  );
}
