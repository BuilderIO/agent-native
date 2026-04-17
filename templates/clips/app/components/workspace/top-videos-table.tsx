import { Link } from "react-router";
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
      <div className="py-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recording</TableHead>
            <TableHead className="text-right w-24">{metricLabel}</TableHead>
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
              <TableCell className="text-right tabular-nums">
                {row.count.toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
