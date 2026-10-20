import type { MotionEase, MotionKeyframe } from "./motion-timeline";

export type MotionBuiltInRecipeCategory = "enter" | "cycle" | "exit";
export type MotionBuiltInRecipeProperty =
  | "translate"
  | "scale"
  | "rotate"
  | "opacity";
export type MotionBuiltInRecipeTempo = "fast" | "medium" | "slow";

export interface MotionBuiltInRecipeTrack {
  readonly id: string;
  readonly property: MotionBuiltInRecipeProperty;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly easing: MotionEase;
  readonly keyframes: readonly [
    Readonly<MotionKeyframe>,
    Readonly<MotionKeyframe>,
  ];
}

export interface MotionBuiltInRecipe {
  readonly id: string;
  readonly category: MotionBuiltInRecipeCategory;
  readonly tempo: MotionBuiltInRecipeTempo;
  readonly nameKey: string;
  readonly tracks: readonly MotionBuiltInRecipeTrack[];
}

type RecipeTrackInput = Omit<MotionBuiltInRecipeTrack, "id">;

const ease = {
  curve01: "cubic-bezier(0.15,0.85,0.3,1)",
  curve02: "cubic-bezier(0.05,0.4,0.5,1)",
  curve03: "cubic-bezier(0.7,0,0.85,0.15)",
  curve04: "spring(0.6666667)",
  curve05: "spring(0.6535898)",
  curve06: "spring(0.4023857)",
  curve07: "spring(0.7923651)",
  curve08: "spring(0.6165175)",
  curve09: "spring(0.944467)",
  curve10: "cubic-bezier(0.5,1.7,0.3,1)",
  curve11: "cubic-bezier(0.4,1.75,0.3,1)",
  curve12: "cubic-bezier(0.3,-1.2,0.45,1)",
  curve13: "cubic-bezier(0.24,0.08,0.5,1)",
  curve14: "cubic-bezier(0.15,0.55,0.7,1)",
  curve15: "cubic-bezier(0.5,0,0.1,1)",
  curve16: "cubic-bezier(0.61,1,0.88,1)",
  curve17: "cubic-bezier(0.37,0,0.63,1)",
  curve18: "cubic-bezier(0.12,0,0.39,0)",
  curve19: "cubic-bezier(0.5,0,0.2,1)",
  curve20: "cubic-bezier(0.5,0,0.1,1)",
  curve21: "cubic-bezier(0.8,0,0.5,1)",
  curve22: "cubic-bezier(0.7,0,0.5,-0.7)",
  curve23: "cubic-bezier(0.6,0,0.7,-0.5)",
  curve24: "cubic-bezier(0.5,0,0.5,1)",
  curve25: "cubic-bezier(0.5,0,0.95,0.6)",
  curve26: "cubic-bezier(0.6,0,0.5,0.9)",
  curve27: "cubic-bezier(0.15,0.95,0.5,1)",
  curve28: "cubic-bezier(0.5,0,0.85,0.05)",
  curve29: "cubic-bezier(0.3,0,0.5,1)",
  curve30: "cubic-bezier(0.7,0,0.85,0.15)",
} as const satisfies Record<string, MotionEase>;

function numberText(value: number): string {
  return String(Number(value.toFixed(7)));
}

function point(x: number, y: number): string {
  return `${numberText(x)}px ${numberText(y)}px`;
}

function scale(widthPercent: number, heightPercent: number): string {
  return `${numberText(widthPercent / 100)} ${numberText(heightPercent / 100)}`;
}

function rotation(degrees: number): string {
  return `${numberText(degrees)}deg`;
}

function opacity(percent: number): string {
  return numberText(percent / 100);
}

function track(
  property: MotionBuiltInRecipeProperty,
  from: string,
  to: string,
  delayMs: number,
  durationMs: number,
  easing: MotionEase,
): RecipeTrackInput {
  return {
    property,
    delayMs,
    durationMs,
    easing,
    keyframes: [
      { t: 0, value: from },
      { t: 1, value: to },
    ],
  };
}

function translate(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  delayMs: number,
  durationMs: number,
  easing: MotionEase,
): RecipeTrackInput {
  return track(
    "translate",
    point(fromX, fromY),
    point(toX, toY),
    delayMs,
    durationMs,
    easing,
  );
}

function scaling(
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
  delayMs: number,
  durationMs: number,
  easing: MotionEase,
): RecipeTrackInput {
  return track(
    "scale",
    scale(fromWidth, fromHeight),
    scale(toWidth, toHeight),
    delayMs,
    durationMs,
    easing,
  );
}

function rotating(
  from: number,
  to: number,
  delayMs: number,
  durationMs: number,
  easing: MotionEase,
): RecipeTrackInput {
  return track(
    "rotate",
    rotation(from),
    rotation(to),
    delayMs,
    durationMs,
    easing,
  );
}

function opacityTrack(
  from: number,
  to: number,
  delayMs: number,
  durationMs: number,
  easing: MotionEase,
): RecipeTrackInput {
  return track(
    "opacity",
    opacity(from),
    opacity(to),
    delayMs,
    durationMs,
    easing,
  );
}

function recipe(
  id: string,
  category: MotionBuiltInRecipeCategory,
  nameKey: string,
  tempo: MotionBuiltInRecipeTempo,
  rows: readonly RecipeTrackInput[],
): MotionBuiltInRecipe {
  return {
    id,
    category,
    tempo,
    nameKey,
    tracks: rows.map((row, index) => ({
      id: `${id}.track-${index + 1}`,
      ...row,
    })),
  };
}

const recipes = [
  recipe(
    "enter.recipe-01",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe01",
    "fast",
    [
      translate(0, 116, 0, 0, 0, 300, "cubic-bezier(0.07,0.97,0.58,1)"),
      scaling(80, 80, 100, 100, 0, 300, "cubic-bezier(0.07,0.97,0.58,1)"),
      rotating(-90, 0, 0, 300, "cubic-bezier(0.07,0.97,0.58,1)"),
      opacityTrack(0, 100, 0, 30, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-02",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe02",
    "fast",
    [
      translate(0, 20, 0, 0, 0, 300, ease.curve01),
      scaling(0, 0, 100, 100, 0, 300, ease.curve01),
      rotating(60, 0, 0, 300, ease.curve01),
      opacityTrack(0, 100, 0, 80, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-03",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe03",
    "fast",
    [
      translate(120, 0, 0, 0, 0, 300, ease.curve10),
      opacityTrack(0, 100, 0, 80, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-04",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe04",
    "fast",
    [
      translate(0, -120, 0, 0, 0, 100, "cubic-bezier(0.58,0.26,1,1)"),
      translate(0, 0, 0, -4, 100, 30, ease.curve01),
      scaling(100, 100, 120, 80, 100, 30, ease.curve01),
      translate(0, 4, 0, 0, 130, 1080, ease.curve04),
      scaling(120, 80, 100, 100, 130, 1080, ease.curve04),
      opacityTrack(0, 100, 0, 80, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-05",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe05",
    "medium",
    [
      translate(0, -40, 0, 0, 0, 600, ease.curve02),
      opacityTrack(0, 100, 0, 400, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-06",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe06",
    "medium",
    [scaling(0, 0, 100, 100, 0, 900, ease.curve11)],
  ),
  recipe(
    "enter.recipe-07",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe07",
    "medium",
    [
      translate(-120, 0, 0, 0, 0, 600, ease.curve02),
      opacityTrack(0, 100, 0, 150, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-08",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe08",
    "medium",
    [
      translate(0, -60, 0, 0, 0, 1200, ease.curve05),
      opacityTrack(0, 100, 0, 150, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-09",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe09",
    "slow",
    [
      translate(0, 20, 0, 0, 0, 1000, ease.curve12),
      scaling(60, 60, 100, 100, 0, 780, "cubic-bezier(0.15,0.52,0.5,1)"),
      opacityTrack(0, 100, 0, 400, "cubic-bezier(0.09,0.55,0.5,1)"),
    ],
  ),
  recipe(
    "enter.recipe-10",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe10",
    "slow",
    [
      translate(30, 0, 0, 0, 0, 1000, ease.curve13),
      translate(0, 30, 0, 0, 0, 1000, ease.curve02),
      scaling(0, 0, 100, 100, 0, 1000, ease.curve02),
      rotating(60, 0, 0, 1000, ease.curve02),
      opacityTrack(0, 100, 0, 400, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-11",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe11",
    "slow",
    [
      translate(0, 10, 0, 0, 0, 1000, ease.curve02),
      scaling(90, 90, 100, 100, 0, 800, ease.curve02),
      rotating(-20, 0, 0, 900, ease.curve02),
      opacityTrack(0, 100, 0, 400, ease.curve24),
    ],
  ),
  recipe(
    "enter.recipe-12",
    "enter",
    "designEditor.motion.builtInRecipes.enter.recipe12",
    "slow",
    [
      translate(0, -80, 0, 0, 0, 1000, ease.curve14),
      translate(40, 0, -20, 0, 0, 500, ease.curve24),
      translate(0, 0, 20, 0, 500, 500, ease.curve24),
      opacityTrack(0, 100, 0, 500, ease.curve24),
    ],
  ),

  recipe(
    "cycle.recipe-01",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe01",
    "fast",
    [rotating(0, 90, 0, 750, ease.curve06)],
  ),
  recipe(
    "cycle.recipe-02",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe02",
    "fast",
    [
      scaling(100, 100, 80, 80, 0, 50, ease.curve01),
      opacityTrack(100, 50, 5, 45, ease.curve01),
      scaling(80, 80, 100, 100, 115, 485, ease.curve29),
      opacityTrack(50, 100, 115, 435, ease.curve29),
    ],
  ),
  recipe(
    "cycle.recipe-03",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe03",
    "fast",
    [
      scaling(100, 100, 120, 120, 0, 300, ease.curve01),
      scaling(120, 120, 100, 100, 300, 300, ease.curve24),
    ],
  ),
  recipe(
    "cycle.recipe-04",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe04",
    "fast",
    [
      translate(-130, 0, -10, 0, 0, 220, ease.curve27),
      translate(0, 0, 20, 0, 220, 560, "linear"),
      translate(0, 0, 120, 0, 780, 220, ease.curve28),
      opacityTrack(0, 100, 0, 20, ease.curve24),
      opacityTrack(100, 0, 980, 20, ease.curve24),
    ],
  ),
  recipe(
    "cycle.recipe-05",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe05",
    "medium",
    [rotating(0, 360, 0, 2000, ease.curve15)],
  ),
  recipe(
    "cycle.recipe-06",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe06",
    "medium",
    [
      translate(0, 0, 0, 4, 0, 115, ease.curve15),
      translate(0, 0, 0, -4, 115, 135, ease.curve30),
      translate(0, 0, 0, -60, 250, 250, ease.curve01),
      translate(0, 0, 0, 60, 500, 250, ease.curve30),
      translate(0, 0, 0, 4, 750, 135, ease.curve01),
      translate(0, 0, 0, -4, 885, 730, ease.curve08),
      rotating(0, -360, 250, 500, ease.curve24),
    ],
  ),
  recipe(
    "cycle.recipe-07",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe07",
    "medium",
    [rotating(0, 6, 0, 1000, ease.curve07)],
  ),
  recipe(
    "cycle.recipe-08",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe08",
    "medium",
    [
      translate(0, 0, 20, 0, 0, 200, ease.curve15),
      scaling(100, 100, 120, 120, 0, 200, ease.curve15),
      translate(0, 0, -80, 0, 200, 800, ease.curve15),
      scaling(120, 120, 90, 90, 200, 800, ease.curve15),
    ],
  ),
  recipe(
    "cycle.recipe-09",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe09",
    "slow",
    [
      translate(0, 0, -2, 0, 0, 416, ease.curve16),
      translate(0, 0, 4, 0, 416, 416, ease.curve17),
      translate(0, 0, -4, 0, 832, 836, ease.curve17),
      translate(0, 0, 4, 0, 1668, 416, ease.curve17),
      translate(0, 0, -2, 0, 2084, 416, ease.curve18),
      translate(0, 0, 0, -10, 0, 1250, ease.curve17),
      translate(0, 0, 0, 10, 1250, 1250, ease.curve17),
    ],
  ),
  recipe(
    "cycle.recipe-10",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe10",
    "slow",
    [
      translate(0, 0, -60, 0, 0, 625, ease.curve16),
      translate(0, 0, 120, 0, 625, 1250, ease.curve17),
      translate(0, 0, -60, 0, 1875, 625, ease.curve18),
      translate(0, 60, 0, -60, 0, 1250, ease.curve17),
      translate(0, 0, 0, 120, 1250, 1250, ease.curve17),
      rotating(-360, 0, 0, 2500, "linear"),
    ],
  ),
  recipe(
    "cycle.recipe-11",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe11",
    "slow",
    [
      scaling(100, 100, 120, 120, 0, 900, ease.curve19),
      opacityTrack(0, 100, 200, 700, ease.curve19),
      scaling(120, 120, 100, 100, 1400, 900, ease.curve21),
      opacityTrack(100, 0, 1400, 700, ease.curve21),
    ],
  ),
  recipe(
    "cycle.recipe-12",
    "cycle",
    "designEditor.motion.builtInRecipes.cycle.recipe12",
    "slow",
    [
      scaling(100, 100, 200, 200, 0, 2200, ease.curve20),
      opacityTrack(100, 0, 300, 1700, "cubic-bezier(0.3,0,0.45,0.65)"),
    ],
  ),

  recipe(
    "exit.recipe-01",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe01",
    "fast",
    [
      translate(0, 0, 0, -116, 0, 300, ease.curve03),
      scaling(100, 100, 80, 80, 0, 300, ease.curve03),
      rotating(0, 90, 0, 300, ease.curve03),
      opacityTrack(100, 0, 270, 30, ease.curve24),
    ],
  ),
  recipe(
    "exit.recipe-02",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe02",
    "fast",
    [
      translate(0, 0, -5, 0, 0, 40, ease.curve30),
      translate(0, 0, 5, 0, 40, 1660, ease.curve09),
      scaling(100, 100, 0, 0, 0, 300, ease.curve30),
      opacityTrack(100, 0, 50, 250, ease.curve24),
    ],
  ),
  recipe(
    "exit.recipe-03",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe03",
    "fast",
    [
      translate(0, 0, 120, 0, 0, 300, ease.curve22),
      opacityTrack(100, 0, 150, 150, ease.curve24),
    ],
  ),
  recipe(
    "exit.recipe-04",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe04",
    "fast",
    [
      translate(0, 0, -120, 0, 0, 300, ease.curve03),
      scaling(100, 100, 60, 60, 0, 300, ease.curve03),
      opacityTrack(100, 0, 150, 150, ease.curve24),
    ],
  ),
  recipe(
    "exit.recipe-05",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe05",
    "medium",
    [
      scaling(100, 100, 250, 250, 0, 600, ease.curve01),
      opacityTrack(100, 0, 100, 450, ease.curve01),
    ],
  ),
  recipe(
    "exit.recipe-06",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe06",
    "medium",
    [
      scaling(100, 100, 60, 60, 0, 600, ease.curve03),
      opacityTrack(100, 0, 100, 500, ease.curve03),
    ],
  ),
  recipe(
    "exit.recipe-07",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe07",
    "medium",
    [
      translate(0, 0, -60, 0, 0, 600, ease.curve23),
      rotating(0, -180, 0, 600, ease.curve22),
      opacityTrack(100, 0, 300, 300, ease.curve25),
    ],
  ),
  recipe(
    "exit.recipe-08",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe08",
    "medium",
    [
      translate(0, 0, 0, 70, 0, 300, ease.curve03),
      translate(0, 0, 0, 19, 300, 100, ease.curve01),
      scaling(100, 120, 175, 5, 300, 100, ease.curve01),
      scaling(175, 120, 150, 5, 400, 200, ease.curve25),
      opacityTrack(100, 0, 520, 80, ease.curve25),
    ],
  ),
  recipe(
    "exit.recipe-09",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe09",
    "slow",
    [
      translate(0, 0, 0, -40, 0, 1500, ease.curve25),
      scaling(100, 100, 150, 150, 0, 1500, ease.curve25),
      opacityTrack(100, 0, 0, 1500, ease.curve26),
    ],
  ),
  recipe(
    "exit.recipe-10",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe10",
    "slow",
    [
      scaling(100, 100, 80, 80, 0, 1500, ease.curve25),
      opacityTrack(100, 0, 250, 1250, ease.curve26),
    ],
  ),
  recipe(
    "exit.recipe-11",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe11",
    "slow",
    [
      translate(0, 0, 0, 60, 0, 1500, "cubic-bezier(0.5,0,0.7,0.7)"),
      scaling(100, 100, 80, 80, 450, 1050, "cubic-bezier(0.5,0,0.7,0.7)"),
      opacityTrack(100, 0, 750, 750, ease.curve26),
    ],
  ),
  recipe(
    "exit.recipe-12",
    "exit",
    "designEditor.motion.builtInRecipes.exit.recipe12",
    "slow",
    [
      translate(0, 0, 120, 0, 0, 1500, ease.curve25),
      rotating(0, 180, 0, 1500, ease.curve25),
      opacityTrack(100, 0, 1090, 410, ease.curve24),
    ],
  ),
] as const satisfies readonly MotionBuiltInRecipe[];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Target-independent local recipes, kept separate from saved user styles. */
export const MOTION_BUILT_IN_RECIPES = deepFreeze(recipes);
