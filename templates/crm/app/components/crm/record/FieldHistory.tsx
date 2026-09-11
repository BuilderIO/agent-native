/**
 * The "changed from X to Y" affordance next to a history-tracked attribute.
 *
 * A dialog rather than a hover card: the template ships no popover primitive,
 * and the house rule forbids hand-rolling one. History is fetched only when the
 * dialog opens — the panel would otherwise issue one query per attribute.
 */

import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconHistory } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmAttributeDefinition } from "../../../../shared/crm-contract";
import { FieldValueDisplay } from "./field-editors";
import { historyTransitions, type FieldHistoryResponse } from "./record-data";

export function FieldHistoryButton({
  recordId,
  entryId,
  attribute,
}: {
  recordId: string;
  entryId?: string;
  attribute: Pick<
    CrmAttributeDefinition,
    | "apiSlug"
    | "label"
    | "attributeType"
    | "multi"
    | "options"
    | "config"
    | "archived"
    | "storagePolicy"
    | "updateable"
    | "required"
  >;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const query = useActionQuery<FieldHistoryResponse>(
    "list-crm-record-field-history" as never,
    {
      recordId,
      apiSlug: attribute.apiSlug,
      ...(entryId ? { entryId } : {}),
    } as never,
    { enabled: open },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 cursor-pointer text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t("record.viewHistory", { field: attribute.label })}
        >
          <IconHistory className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("record.historyTitle", { field: attribute.label })}
          </DialogTitle>
          <DialogDescription>
            {t("record.historyDescription")}
          </DialogDescription>
        </DialogHeader>
        <FieldHistoryBody attribute={attribute} query={query} />
      </DialogContent>
    </Dialog>
  );
}

function FieldHistoryBody({
  attribute,
  query,
}: {
  attribute: React.ComponentProps<typeof FieldValueDisplay>["attribute"] & {
    label: string;
  };
  query: {
    data?: FieldHistoryResponse;
    isLoading: boolean;
    error: unknown;
  };
}) {
  const t = useT();
  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error)
    return (
      <p className="text-sm text-destructive">
        {query.error instanceof Error
          ? query.error.message
          : t("record.historyLoadFailed")}
      </p>
    );
  const data = query.data;
  if (!data) return null;
  // Not tracked and no changes are different answers: one says history is off
  // for this attribute, the other says it is on and empty.
  if (!data.historyTracked)
    return (
      <p className="text-sm text-muted-foreground">
        {t("record.historyNotTracked")}
      </p>
    );
  const transitions = historyTransitions(data.changes);
  if (!transitions.length)
    return (
      <p className="text-sm text-muted-foreground">
        {t("record.historyEmpty")}
      </p>
    );

  return (
    <ol className="divide-y divide-border/70 overflow-y-auto rounded-md border border-border/70">
      {transitions.map((transition) => (
        <li key={transition.id} className="grid gap-1 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {transition.from === undefined ? (
              <span className="text-muted-foreground">
                {t("record.historySet")}
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  <FieldValueDisplay
                    attribute={attribute}
                    value={transition.from}
                  />
                </span>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </>
            )}
            <span className="font-medium">
              <FieldValueDisplay attribute={attribute} value={transition.to} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("record.historyBy", {
              actor: transition.actorId ?? transition.actorType,
              when: formatWhen(transition.at),
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
