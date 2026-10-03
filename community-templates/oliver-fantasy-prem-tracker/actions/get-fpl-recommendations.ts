import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getEnrichedPlayers,
  getUpcomingFixtures,
  type EnrichedPlayer,
  type FplFixture,
} from "../server/lib/fpl.js";

const FIXTURE_WINDOW = 3;

function upcomingDifficultyForTeam(
  teamId: number,
  fixtures: FplFixture[],
): { average: number; opponents: string[] } | null {
  const teamFixtures = fixtures
    .filter(
      (fixture) =>
        !fixture.finished &&
        fixture.event !== null &&
        (fixture.teamHomeId === teamId || fixture.teamAwayId === teamId),
    )
    .sort((a, b) => (a.event as number) - (b.event as number));

  const nextGameweeks = [
    ...new Set(teamFixtures.map((fixture) => fixture.event as number)),
  ].slice(0, FIXTURE_WINDOW);
  if (nextGameweeks.length === 0) return null;

  const gameweekSet = new Set(nextGameweeks);
  const upcoming = teamFixtures.filter((fixture) =>
    gameweekSet.has(fixture.event as number),
  );
  const difficulties = upcoming.map((fixture) =>
    fixture.teamHomeId === teamId
      ? fixture.teamHomeDifficulty
      : fixture.teamAwayDifficulty,
  );
  const average =
    difficulties.reduce((sum, value) => sum + value, 0) / difficulties.length;
  return {
    average,
    opponents: upcoming.map((fixture) => String(fixture.event)),
  };
}

function isAvailable(player: EnrichedPlayer): boolean {
  if (player.status !== "a") return false;
  if (player.chanceOfPlayingNextRound === null) return true;
  return player.chanceOfPlayingNextRound >= 75;
}

function buildReason(player: EnrichedPlayer, avgDifficulty: number): string {
  const fixtureNote =
    avgDifficulty <= 2.4
      ? "a kind run of fixtures"
      : avgDifficulty <= 3.2
        ? "a manageable run of fixtures"
        : "a tough run of fixtures";
  const formNote =
    player.form >= 6
      ? "excellent recent form"
      : player.form >= 4
        ? "solid recent form"
        : "modest recent form";
  const ownershipNote =
    player.selectedByPercent < 10
      ? `a differential pick at only ${player.selectedByPercent}% ownership`
      : `owned by ${player.selectedByPercent}% of managers`;
  return `${player.webName} (${player.teamShortName}) has ${formNote} (${player.form} form, ${player.pointsPerGame} pts/game) and ${fixtureNote} over the next ${FIXTURE_WINDOW} gameweeks (avg FDR ${avgDifficulty.toFixed(1)}). ${ownershipNote}.`;
}

export default defineAction({
  description:
    'Recommend Fantasy Premier League players to sign and give tips on who is likely to play well and score points in upcoming gameweeks, based on current form, points per game, and fixture difficulty over the next few gameweeks. Returns two ranked lists: "essentialPicks" (owned by 10%+ of managers) and "differentials" (owned by under 10%). Optionally filter to one position.',
  schema: z.object({
    position: z
      .enum(["GKP", "DEF", "MID", "FWD"])
      .optional()
      .describe(
        "Restrict recommendations to one position. Omit for all positions.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(30)
      .default(6)
      .describe(
        "How many players to return per list (essentialPicks and differentials). Defaults to 6.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ position, limit }) => {
    const [players, fixtures] = await Promise.all([
      getEnrichedPlayers(),
      getUpcomingFixtures(),
    ]);

    const candidates = players.filter(
      (player) =>
        player.minutes >= 90 &&
        isAvailable(player) &&
        (!position || player.positionShort === position),
    );

    const DIFFERENTIAL_OWNERSHIP_THRESHOLD = 10;

    const scored = candidates
      .map((player) => {
        const difficulty = upcomingDifficultyForTeam(player.teamId, fixtures);
        if (!difficulty) return null;
        const score =
          player.form * 2 +
          player.pointsPerGame * 1.2 +
          player.ictIndex * 0.15 -
          difficulty.average * 2.5;
        return {
          id: player.id,
          name: player.webName,
          team: player.teamShortName,
          position: player.positionShort,
          priceMillions: player.nowCostMillions,
          ownershipPercent: player.selectedByPercent,
          form: player.form,
          pointsPerGame: player.pointsPerGame,
          totalPoints: player.totalPoints,
          upcomingFixtureDifficulty: Number(difficulty.average.toFixed(1)),
          tag:
            player.selectedByPercent < DIFFERENTIAL_OWNERSHIP_THRESHOLD
              ? "differential"
              : "popular-pick",
          score: Number(score.toFixed(2)),
          reason: buildReason(player, difficulty.average),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.score - a.score);

    const essentialPicks = scored
      .filter((entry) => entry.tag === "popular-pick")
      .slice(0, limit);
    const differentials = scored
      .filter((entry) => entry.tag === "differential")
      .slice(0, limit);

    return { essentialPicks, differentials };
  },
});
