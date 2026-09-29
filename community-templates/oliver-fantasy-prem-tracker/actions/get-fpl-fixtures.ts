import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getBootstrap, getUpcomingFixtures } from "../server/lib/fpl.js";

export default defineAction({
  description:
    "Get upcoming Premier League fixtures with each team's FPL fixture difficulty rating (1 easiest to 5 hardest), grouped by gameweek.",
  schema: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(20)
      .describe("Maximum number of upcoming fixtures to return. Defaults to 20."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit }) => {
    const [bootstrap, fixtures] = await Promise.all([
      getBootstrap(),
      getUpcomingFixtures(),
    ]);
    const teamsById = new Map(bootstrap.teams.map((team) => [team.id, team]));
    const upcoming = fixtures
      .filter((fixture) => !fixture.finished)
      .sort((a, b) => (a.event ?? 0) - (b.event ?? 0))
      .slice(0, limit)
      .map((fixture) => ({
        gameweek: fixture.event,
        kickoffTime: fixture.kickoffTime,
        home: teamsById.get(fixture.teamHomeId)?.shortName ?? "UNK",
        away: teamsById.get(fixture.teamAwayId)?.shortName ?? "UNK",
        homeDifficulty: fixture.teamHomeDifficulty,
        awayDifficulty: fixture.teamAwayDifficulty,
      }));
    return { fixtures: upcoming };
  },
});
