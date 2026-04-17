import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  if (!rows.length) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No creators yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Creator</TableHead>
            <TableHead className="text-right w-24">Recordings</TableHead>
            <TableHead className="text-right w-20">Views</TableHead>
            <TableHead className="text-right w-28">Engagement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.email}>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-7 w-7 flex-shrink-0">
                    <AvatarFallback className="text-xs bg-[#625DF5] text-white">
                      {initials(row.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{row.email}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.recordings.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.views.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.engagement.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
