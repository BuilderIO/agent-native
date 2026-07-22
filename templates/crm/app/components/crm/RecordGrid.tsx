import { Badge } from "@agent-native/toolkit/ui/badge";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-native/toolkit/ui/table";
import { IconArrowUpRight, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { LoadingRows, SetupEmptyState } from "@/components/crm/Surface";
import type { CrmKind, CrmRecordSummary } from "@/lib/types";

const labels: Record<CrmKind, string> = {
  account: "Account",
  person: "Person",
  opportunity: "Opportunity",
};

export function RecordGrid({
  kind,
  records,
  isLoading,
  emptyTitle,
}: {
  kind: CrmKind;
  records: CrmRecordSummary[];
  isLoading: boolean;
  emptyTitle: string;
}) {
  const [params, setParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(params.get("q") ?? "");
  const query = (params.get("q") ?? "").trim().toLowerCase();
  useEffect(() => {
    setDraftQuery(params.get("q") ?? "");
  }, [params]);
  const filtered = records.filter((record) =>
    `${record.displayName} ${record.subtitle ?? ""} ${record.owner ?? ""}`
      .toLowerCase()
      .includes(query),
  );

  function updateSearch(value: string) {
    setDraftQuery(value);
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  }

  if (isLoading) return <LoadingRows rows={7} />;
  if (!records.length) return <SetupEmptyState title={emptyTitle} />;

  return (
    <div className="p-5 sm:p-7">
      <div className="mb-4 flex max-w-sm items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={draftQuery}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder={`Search ${labels[kind].toLowerCase()}s`}
          className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels[kind]}</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="hidden lg:table-cell">Cadence</TableHead>
              <TableHead>Next step</TableHead>
              <TableHead className="w-8">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="min-w-[220px]">
                  <Link
                    to={`/records/${encodeURIComponent(record.id)}`}
                    className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="font-medium">{record.displayName}</p>
                    {record.subtitle ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {record.subtitle}
                      </p>
                    ) : null}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {record.owner ?? "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {record.cadence ? (
                    <Badge variant="secondary" className="font-normal">
                      {record.cadence}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-[260px] truncate text-muted-foreground">
                  {record.nextStep ?? record.stage ?? "—"}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/records/${encodeURIComponent(record.id)}`}
                    className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open ${record.displayName}`}
                  >
                    <IconArrowUpRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {records.length > 0 && filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No matching {labels[kind].toLowerCase()}s.
        </p>
      ) : null}
    </div>
  );
}
