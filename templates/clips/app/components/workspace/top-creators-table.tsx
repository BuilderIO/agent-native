import { useT } from "@agent-native/core/client/i18n";

import { ClipsAvatar } from "@/components/clips-avatar";
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
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t("clipsFinalRaw.noCreatorsYet")}
      </div>
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
          {rows.map((row) => (
            <TableRow key={row.email}>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <ClipsAvatar
                    email={row.email}
                    alt={row.email}
                    fallback={initials(row.email)}
                    className="h-7 w-7 flex-shrink-0"
                    fallbackClassName="text-xs bg-primary text-primary-foreground"
                  />
                  <span className="truncate">{row.email}</span>
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
