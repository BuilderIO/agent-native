import type { StoryKey } from "../story-graphs.fixture.js";
import {
  runScenario,
  type EffectSummary,
  type ScenarioRun,
  type ScenarioSummary,
} from "../testing/story-data.js";
import type { StoryRuns } from "./coverage.js";
import { STORIES } from "./registry.js";

// Helpers for the proof specs: run a story's named scenario once per test
// file, and read what it did.

const cache = new Map<string, Promise<ScenarioRun>>();

/** Runs one scenario of a story, once per test file. */
export function scenarioRun(
  story: StoryKey,
  scenario: string,
): Promise<ScenarioRun> {
  const key = `${story}/${scenario}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const { script, fixtures } = STORIES[story];
  const definition = script.scenarios[scenario];
  if (definition === undefined) {
    throw new Error(
      `Story "${story}" has no scenario "${scenario}"; it has ${Object.keys(script.scenarios).join(", ") || "none"}.`,
    );
  }
  const started = runScenario(story, definition, fixtures);
  cache.set(key, started);
  return started;
}

/** Every scenario of every story, run. */
export async function runAllStories(): Promise<StoryRuns> {
  const runs = {} as StoryRuns;
  for (const story of Object.values(STORIES)) {
    runs[story.key] = {};
    for (const name of Object.keys(story.script.scenarios)) {
      runs[story.key][name] = await scenarioRun(story.key, name);
    }
  }
  return runs;
}

/** Every write the scenario made, in order, optionally only those of one operation. */
export function effectsOf(
  summary: ScenarioSummary,
  operation?: string,
): EffectSummary[] {
  return summary.ticks
    .flatMap((tick) => tick.effects)
    .filter(
      (effect) => operation === undefined || effect.operation === operation,
    );
}

/** How many times the scenario called an operation, reads and writes. */
export function callsTo(summary: ScenarioSummary, operation: string): number {
  return summary.ticks.reduce(
    (total, tick) => total + (tick.calls[operation] ?? 0),
    0,
  );
}

/** The tick at `index`, or a loud failure naming what the scenario has. */
export function tickAt(summary: ScenarioSummary, index: number) {
  const found = summary.ticks[index];
  if (found === undefined) {
    throw new Error(
      `No tick ${index}; the scenario ran ${summary.ticks.length}.`,
    );
  }
  return found;
}

/** Items that ended with `outcome`, from their journeys. */
export function endedWith(summary: ScenarioSummary, outcome: string): string[] {
  return Object.entries(summary.journeys)
    .filter(([, steps]) =>
      steps.some(
        (step) => step.endsWith(`:${outcome}`) && step.startsWith("ended@"),
      ),
    )
    .map(([item]) => item);
}
