import { useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CATEGORIES = [
  { value: "points", label: "Points", valueLabel: "Pts" },
  { value: "goals", label: "Goals", valueLabel: "Goals" },
  { value: "assists", label: "Assists", valueLabel: "Assists" },
  { value: "clean_sheets", label: "Clean sheets", valueLabel: "CS" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

export function LeadersPanel() {
  const [category, setCategory] = useState<Category>("points");
  const activeCategory = CATEGORIES.find((entry) => entry.value === category)!;
  const { data, isLoading, isError } = useActionQuery(
    "get-fpl-leaders",
    { category, limit: 10 },
    { refetchInterval: 60_000 },
  );
  const leaders = data?.leaders ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Leaderboards</CardTitle>
        <Tabs
          value={category}
          onValueChange={(value) => setCategory(value as Category)}
        >
          <TabsList>
            {CATEGORIES.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Couldn't load leaderboards. Try again shortly.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead className="text-right">
                  {activeCategory.valueLabel}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaders.map((player, index) => (
                <TableRow key={player.id}>
                  <TableCell className="text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">{player.name}</TableCell>
                  <TableCell>{player.team}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {player.position}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {player.value}
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
