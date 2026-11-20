import { afterEach, expect, inject } from "vitest";
import { commands, page } from "vitest/browser";

import {
  APPEARANCES,
  outcomeFromError,
  type ShotResult,
  shotFile,
} from "./results.ts";

declare module "vitest" {
  export interface ProvidedContext {
    storybookVisual: { mode: "record" | "compare"; resultsDir: string };
  }
}

interface StoryTestContext {
  story?: {
    id: string;
    parameters: { screenshot?: boolean };
  };
}

const { mode, resultsDir } = inject("storybookVisual");

// How long two consecutive screenshots may take to agree. Vitest's 5 s is
// too short once every core is rendering a story.
const SETTLE_TIMEOUT = 15_000;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Runs after the story test's render, play function and axe check, while the
// story is still mounted. The stage decorator draws an appearance as a class
// on the stage, and the foundation pages watch that class, so swapping it is
// the same change the toolbar makes.
afterEach(async (context) => {
  const story = (context as typeof context & StoryTestContext).story;
  if (!story || (context.task.result?.errors?.length ?? 0) > 0) return;

  const record = async (result: ShotResult) => {
    await commands.writeFile(
      `${resultsDir}/${result.storyId}--${result.appearance}.json`,
      JSON.stringify(result),
    );
  };

  if (story.parameters.screenshot === false) {
    for (const appearance of APPEARANCES) {
      await record({
        storyId: story.id,
        appearance,
        file: shotFile(story.id, appearance),
        outcome: "skipped",
      });
    }
    return;
  }

  const stage = document.querySelector<HTMLElement>("[data-storybook-stage]");
  const root = stage?.firstElementChild;
  if (!stage || !(root instanceof HTMLElement)) {
    throw new Error(`Story ${story.id} rendered without the Storybook stage`);
  }
  await document.fonts.ready;
  const initial = stage.classList.contains("dark") ? "dark" : "light";

  try {
    for (const appearance of APPEARANCES) {
      stage.classList.remove(...APPEARANCES);
      stage.classList.add(appearance);
      await nextFrame();
      await nextFrame();
      const file = shotFile(story.id, appearance);
      try {
        await expect
          .element(page.elementLocator(root))
          .toMatchScreenshot(file, { timeout: SETTLE_TIMEOUT });
        await record({
          storyId: story.id,
          appearance,
          file,
          outcome: mode === "record" ? "recorded" : "matched",
        });
      } catch (error) {
        // A visual difference is reported for review, not failed; anything
        // the matcher did not report as a difference still fails the test.
        const outcome = outcomeFromError(error);
        if (!outcome) throw error;
        await record({
          storyId: story.id,
          appearance,
          file,
          outcome,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    stage.classList.remove(...APPEARANCES);
    stage.classList.add(initial);
  }
});
