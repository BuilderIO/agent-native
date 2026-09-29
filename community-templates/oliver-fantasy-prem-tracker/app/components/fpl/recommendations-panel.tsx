import { useActionQuery } from "@agent-native/core/client/hooks";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function RecommendationsPanel() {
  const { data, isLoading } = useActionQuery(
    "get-fpl-recommendations",
    { limit: 8 },
    { refetchInterval: 5 * 60_000 },
  );
  const recommendations = data?.recommendations ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Players to sign this gameweek</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {recommendations.map((player) => (
              <li
                key={player.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{player.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {player.team} · {player.position} · £
                      {player.priceMillions}m
                    </span>
                  </div>
                  <Badge
                    variant={
                      player.tag === "differential" ? "secondary" : "outline"
                    }
                    className="shrink-0"
                  >
                    {player.tag === "differential"
                      ? "Differential"
                      : "Popular pick"}
                  </Badge>
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
