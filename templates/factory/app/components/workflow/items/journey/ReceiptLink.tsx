import { IconExternalLink } from "@tabler/icons-react";

import { safeHttpUrl } from "@/lib/safe-http-url";

import { useItemsStrings } from "../../items-strings";
import type { ReceiptView } from "../read-types";

/**
 * What a write left behind: its reference as a link when the url is a plain
 * web address, as text when it is not, so a stored `javascript:` url is never
 * made clickable.
 */
export function ReceiptLink({
  receipt,
}: {
  receipt: Pick<ReceiptView, "externalRef" | "url">;
}) {
  const s = useItemsStrings();

  const url = safeHttpUrl(receipt.url);
  const label = receipt.externalRef ?? (url ? s.journey.receiptOpen : null);
  if (!label) {
    return (
      <span className="text-xs text-muted-foreground">
        {s.journey.receiptNoRef}
      </span>
    );
  }
  if (!url) {
    return <span className="break-all font-mono text-xs">{label}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
    >
      <span className="break-all font-mono">{label}</span>
      <IconExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}
