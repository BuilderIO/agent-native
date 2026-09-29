import { useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LISTS = [
  {
    value: "essentialPicks",
    label: "Essential picks",
    empty: "No essential picks with a favourable fixture run right now.",
  },
  {
    value: "differentials",
    label: "Differentials",
    empty: "No low-ownership differentials stand out right now.",
  },
] as const;

type ListKey = (typeof LISTS)[number]["value"];

export function RecommendationsPanel() {
  const [list, setList] = useState<ListKey>("essentialPicks");
  const { data, isLoading } = useActionQuery(
    "get-fpl-recommendations",
    { limit: 6 },
    { refetchInterval: 5 * 60_000 },
  );
  const players = data?.[list] ?? [];
  const activeList = LISTS.find((entry) => entry.value === list)!;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Players to sign this gameweek</CardTitle>
        <Tabs value={list} onValueChange={(value) => setList(value as ListKey)}>
          <TabsList>
            {LISTS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : players.length === 0 ? (
          <p className="text-sm text-muted-foreground">{activeList.empty}</p>
        ) : (
          <ul className="space-y-3">
            {players.map((player) => (
              <li
                key={player.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{player.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {player.team} · {player.position} · £{player.priceMillions}m
                    · {player.ownershipPercent}% owned
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {player.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
