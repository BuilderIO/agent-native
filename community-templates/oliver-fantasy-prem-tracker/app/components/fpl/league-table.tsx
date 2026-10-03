import { useActionQuery } from "@agent-native/core/client/hooks";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function LeagueTable() {
  const { data, isLoading, isError } = useActionQuery(
    "get-fpl-table",
    {},
    { refetchInterval: 60_000 },
  );
  const rows = data?.table ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Premier League table</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load the league table. Try again shortly.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Club</TableHead>
                <TableHead className="text-right">P</TableHead>
                <TableHead className="text-right">W</TableHead>
                <TableHead className="text-right">D</TableHead>
                <TableHead className="text-right">L</TableHead>
                <TableHead className="text-right">GD</TableHead>
                <TableHead className="text-right">Pts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.team}>
                  <TableCell className="text-muted-foreground">
                    {row.rank}
                  </TableCell>
                  <TableCell className="font-medium">{row.team}</TableCell>
                  <TableCell className="text-right">{row.played}</TableCell>
                  <TableCell className="text-right">{row.wins}</TableCell>
                  <TableCell className="text-right">{row.draws}</TableCell>
                  <TableCell className="text-right">{row.losses}</TableCell>
                  <TableCell className="text-right">
                    {row.goalDifference > 0 ? "+" : ""}
                    {row.goalDifference}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {row.points}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
