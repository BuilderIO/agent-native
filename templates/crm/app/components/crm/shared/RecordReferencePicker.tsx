/**
 * The record search behind every `record-reference` / `actor-reference` editor.
 *
 * It lives here rather than in either surface because a grid cell and a panel
 * row must resolve a link the same way: same action, same scope, same "no
 * matches" wording. Only the wrapper differs — the grid opens it from a cell
 * popover, the panel from a labelled row.
 */

import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

interface CrmReferenceMatch {
  id: string;
  displayName: string;
  subtitle?: string;
}

/** Two characters, so a picker never asks the server for "every record". */
const MIN_QUERY_LENGTH = 2;

export function RecordReferencePicker({
  label,
  kind,
  selected = [],
  onPick,
  onCancel,
}: {
  /** The attribute's label; shown in the footer hint. */
  label: string;
  /** Narrow the search to one record kind, or `null` to search all kinds. */
  kind: string | null;
  /** Values already linked, so a multi reference can show and toggle them. */
  selected?: string[];
  onPick: (displayName: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = search.trim();
  const results = useActionQuery<{ records?: CrmReferenceMatch[] }>(
    "list-crm-records" as never,
    {
      ...(trimmed ? { query: trimmed } : {}),
      ...(kind ? { kind } : {}),
      limit: 8,
    } as never,
    { enabled: trimmed.length >= MIN_QUERY_LENGTH } as never,
  );
  const records = results.data?.records ?? [];
  const chosen = new Set(selected);

  return (
    <div className="w-64">
      <input
        ref={inputRef}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        placeholder={t("grid.searchRecords")}
        className="w-full border-b border-border/70 bg-transparent px-3 py-2 text-sm outline-none"
      />
      <div className="max-h-56 overflow-y-auto py-1">
        {trimmed.length < MIN_QUERY_LENGTH ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("grid.searchToLink")}
          </p>
        ) : results.isError ? (
          // A failed search is said out loud: "no matches" would claim the
          // record does not exist.
          <p className="px-3 py-2 text-xs text-destructive">
            {t("grid.searchFailed")}
          </p>
        ) : records.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {results.isLoading ? t("grid.searching") : t("grid.noMatches")}
          </p>
        ) : (
          records.map((record) => (
            <button
              key={record.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => onPick(record.displayName)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {record.displayName}
                </span>
                {record.subtitle ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {record.subtitle}
                  </span>
                ) : null}
              </span>
              {chosen.has(record.displayName) ? (
                <IconCheck className="size-3.5 shrink-0" />
              ) : null}
            </button>
          ))
        )}
      </div>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {t("grid.referenceHint", { attribute: label })}
      </p>
    </div>
  );
}
