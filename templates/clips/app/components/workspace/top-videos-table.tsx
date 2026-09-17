import { Link } from "react-router";

import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface TopVideoRow {
  id: string;
  title: string;
  count: number;
}

interface TopVideosTableProps {
  rows: TopVideoRow[];
  metricLabel: string;
  emptyText?: string;
}

export function TopVideosTable({
  rows,
  metricLabel,
  emptyText = "No data yet.",
}: TopVideosTableProps) {
  if (!rows.length) {
    return (
      <Empty className="gap-2 rounded-none py-6 md:p-6">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-medium text-muted-foreground">
            {emptyText}
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
            <TableHead>Recording</TableHead>
            <TableHead className="text-end w-24">{metricLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                <Link
                  to={`/r/${row.id}`}
                  className="hover:underline underline-offset-2"
                >
                  {row.title || "Untitled"}
                </Link>
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {row.count.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
