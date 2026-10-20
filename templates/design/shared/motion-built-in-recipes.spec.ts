import { describe, expect, it } from "vitest";

import { MOTION_BUILT_IN_RECIPES } from "./motion-built-in-recipes";
import type {
  MotionBuiltInRecipe,
  MotionBuiltInRecipeCategory,
  MotionBuiltInRecipeTempo,
} from "./motion-built-in-recipes";
import { isValidMotionEase } from "./motion-easing";

const numberPattern = String.raw`-?(?:\d+\.?\d*|\.\d+)`;

function recipe(id: string): MotionBuiltInRecipe {
  const found = MOTION_BUILT_IN_RECIPES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing built-in recipe: ${id}`);
  return found;
}

function values(entry: MotionBuiltInRecipe): string[][] {
  return entry.tracks.map((track) =>
    track.keyframes.map((keyframe) => keyframe.value),
  );
}

describe("built-in motion recipes", () => {
  it("contains 36 localized recipes split evenly across the three categories", () => {
    expect(MOTION_BUILT_IN_RECIPES).toHaveLength(36);
    expect(
      MOTION_BUILT_IN_RECIPES.reduce<
        Record<MotionBuiltInRecipeCategory, number>
      >(
        (counts, entry) => {
          counts[entry.category] += 1;
          return counts;
        },
        { enter: 0, cycle: 0, exit: 0 },
      ),
    ).toEqual({ enter: 12, cycle: 12, exit: 12 });
    expect(
      MOTION_BUILT_IN_RECIPES.reduce<Record<MotionBuiltInRecipeTempo, number>>(
        (counts, entry) => {
          counts[entry.tempo] += 1;
          return counts;
        },
        { fast: 0, medium: 0, slow: 0 },
      ),
    ).toEqual({ fast: 12, medium: 12, slow: 12 });

    const ids = MOTION_BUILT_IN_RECIPES.map((entry) => entry.id);
    const nameKeys = MOTION_BUILT_IN_RECIPES.map((entry) => entry.nameKey);
    expect(new Set(ids).size).toBe(36);
    expect(new Set(nameKeys).size).toBe(36);
    for (const entry of MOTION_BUILT_IN_RECIPES) {
      expect(entry.nameKey).toBe(
        `designEditor.motion.builtInRecipes.${entry.category}.${entry.id.split(".")[1]?.replace("-", "")}`,
      );
    }
  });

  it("keeps every property row ordered, including repeated rows and separate axes", () => {
    const repeatedTranslateAndScale = recipe("enter.recipe-04");
    expect(
      repeatedTranslateAndScale.tracks.map((track) => track.property),
    ).toEqual([
      "translate",
      "translate",
      "scale",
      "translate",
      "scale",
      "opacity",
    ]);
    expect(values(repeatedTranslateAndScale)).toEqual([
      ["0px -120px", "0px 0px"],
      ["0px 0px", "0px -4px"],
      ["1 1", "1.2 0.8"],
      ["0px 4px", "0px 0px"],
      ["1.2 0.8", "1 1"],
      ["0", "1"],
    ]);
    expect(
      repeatedTranslateAndScale.tracks.map(({ delayMs, durationMs }) => [
        delayMs,
        durationMs,
      ]),
    ).toEqual([
      [0, 100],
      [100, 30],
      [100, 30],
      [130, 1080],
      [130, 1080],
      [0, 80],
    ]);

    const repeatedPositionRows = recipe("enter.recipe-12");
    expect(repeatedPositionRows.tracks.map((track) => track.property)).toEqual([
      "translate",
      "translate",
      "translate",
      "opacity",
    ]);
    expect(values(repeatedPositionRows).slice(0, 3)).toEqual([
      ["0px -80px", "0px 0px"],
      ["40px 0px", "-20px 0px"],
      ["0px 0px", "20px 0px"],
    ]);

    const independentAxes = recipe("cycle.recipe-10");
    expect(independentAxes.tracks.map((track) => track.property)).toEqual([
      "translate",
      "translate",
      "translate",
      "translate",
      "translate",
      "rotate",
    ]);
    expect(values(independentAxes).slice(0, 5)).toEqual([
      ["0px 0px", "-60px 0px"],
      ["0px 0px", "120px 0px"],
      ["0px 0px", "-60px 0px"],
      ["0px 60px", "0px -60px"],
      ["0px 0px", "0px 120px"],
    ]);

    const repeatedScaleRows = recipe("exit.recipe-08");
    expect(values(repeatedScaleRows).slice(2, 4)).toEqual([
      ["1 1.2", "1.75 0.05"],
      ["1.75 1.2", "1.5 0.05"],
    ]);
  });

  it("uses unique stable row ids and valid timing, easing, and endpoint values", () => {
    const trackIds: string[] = [];
    let trackCount = 0;

    for (const entry of MOTION_BUILT_IN_RECIPES) {
      expect(entry.tracks.length).toBeGreaterThan(0);
      for (const [index, track] of entry.tracks.entries()) {
        trackCount += 1;
        trackIds.push(track.id);
        expect(track.id).toBe(`${entry.id}.track-${index + 1}`);
        expect(Number.isFinite(track.delayMs)).toBe(true);
        expect(track.delayMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(track.durationMs)).toBe(true);
        expect(track.durationMs).toBeGreaterThan(0);
        expect(track.delayMs + track.durationMs).toBeLessThanOrEqual(120_000);
        expect(isValidMotionEase(track.easing)).toBe(true);
        expect(track.keyframes).toHaveLength(2);
        expect(track.keyframes.map((keyframe) => keyframe.t)).toEqual([0, 1]);

        for (const keyframe of track.keyframes) {
          expect(typeof keyframe.value).toBe("string");
          expect(keyframe.value.length).toBeGreaterThan(0);
          switch (track.property) {
            case "translate":
              expect(keyframe.value).toMatch(
                new RegExp(`^${numberPattern}px ${numberPattern}px$`),
              );
              break;
            case "scale":
              expect(keyframe.value).toMatch(
                new RegExp(`^${numberPattern} ${numberPattern}$`),
              );
              break;
            case "rotate":
              expect(keyframe.value).toMatch(
                new RegExp(`^${numberPattern}deg$`),
              );
              break;
            case "opacity": {
              expect(keyframe.value).toMatch(new RegExp(`^${numberPattern}$`));
              const value = Number(keyframe.value);
              expect(Number.isFinite(value)).toBe(true);
              expect(value).toBeGreaterThanOrEqual(0);
              expect(value).toBeLessThanOrEqual(1);
              break;
            }
          }
        }
      }
    }

    expect(trackCount).toBe(119);
    expect(new Set(trackIds).size).toBe(trackIds.length);
  });

  it("freezes the recipe catalog and every nested value", () => {
    expect(Object.isFrozen(MOTION_BUILT_IN_RECIPES)).toBe(true);
    for (const entry of MOTION_BUILT_IN_RECIPES) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.tracks)).toBe(true);
      for (const track of entry.tracks) {
        expect(Object.isFrozen(track)).toBe(true);
        expect(Object.isFrozen(track.keyframes)).toBe(true);
        for (const keyframe of track.keyframes) {
          expect(Object.isFrozen(keyframe)).toBe(true);
        }
      }
    }
  });
});
