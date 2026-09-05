import { useT } from "@agent-native/core/client/i18n";

import { ClipsAvatar } from "@/components/clips-avatar";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface TopCreatorRow {
  email: string;
  name?: string | null;
  recordings: number;
  views: number;
  engagement: number;
}

interface TopCreatorsTableProps {
  rows: TopCreatorRow[];
}

function initials(email: string): string {
  const [name] = email.split("@");
  return (name || email).slice(0, 2).toUpperCase();
}

export function TopCreatorsTable({ rows }: TopCreatorsTableProps) {
  const t = useT();
  if (!rows.length) {
    return (
      <Empty className="gap-2 rounded-none py-6 md:p-6">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-medium text-muted-foreground">
            {t("clipsFinalRaw.noCreatorsYet")}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("clipsFinalRaw.creator")}</TableHead>
            <TableHead className="text-end w-24">
              {t("insightsHub.recordings")}
            </TableHead>
            <TableHead className="text-end w-20">
              {t("insightsHub.views")}
            </TableHead>
            <TableHead className="text-end w-28">
              {t("clipsFinalRaw.engagement")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const displayName = row.name?.trim() || row.email;
            return (
              <TableRow key={row.email}>
                <TableCell>
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipsAvatar
                      email={row.email}
                      alt={displayName}
                      fallback={initials(displayName)}
                      className="h-7 w-7 flex-shrink-0"
                      fallbackClassName="text-xs bg-primary text-primary-foreground"
                    />
                    <div className="min-w-0">
                      <div className="truncate">{displayName}</div>
                      {displayName !== row.email ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {row.email}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {row.recordings.toLocaleString()}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {row.views.toLocaleString()}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {row.engagement.toLocaleString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
