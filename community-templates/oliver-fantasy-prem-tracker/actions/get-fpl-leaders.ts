import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getEnrichedPlayers, type EnrichedPlayer } from "../server/lib/fpl.js";

const CATEGORY_FIELD: Record<string, keyof EnrichedPlayer> = {
  goals: "goalsScored",
  assists: "assists",
  clean_sheets: "cleanSheets",
  points: "totalPoints",
};

export default defineAction({
  description:
    'Get the current Premier League / FPL leaderboard for one stat category: "goals" (top scorers), "assists" (top assisters), "clean_sheets" (top clean sheets), or "points" (top fantasy point scorers).',
  schema: z.object({
    category: z
      .enum(["goals", "assists", "clean_sheets", "points"])
      .default("points")
      .describe(
        'Which leaderboard to return: "goals", "assists", "clean_sheets", or "points". Defaults to "points".',
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("How many players to return. Defaults to 10."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ category, limit }) => {
    const field = CATEGORY_FIELD[category];
    const players = await getEnrichedPlayers();
    const sorted = [...players]
      .filter((player) => player.minutes > 0)
      .sort((a, b) => (b[field] as number) - (a[field] as number))
      .slice(0, limit)
      .map((player) => ({
        id: player.id,
        name: player.webName,
        team: player.teamShortName,
        position: player.positionShort,
        value: player[field],
        totalPoints: player.totalPoints,
      }));
    return { category, leaders: sorted };
  },
});
