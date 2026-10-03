import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getLeagueTable } from "../server/lib/fpl.js";

export default defineAction({
  description:
    "Get the live Premier League table this season: rank, played, wins, draws, losses, goal difference, and points for every club, sorted by rank.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const table = await getLeagueTable();
    return { table };
  },
});
