import type { SlideTransitionType } from "../../../shared/slide-transitions";

export type SlideNavigationCommand = "next" | "prev";
export type SlideDirection = "forward" | "backward";

export interface SlideFlight {
  id: number;
  /** Slide the flight lands on. The displayed index moves only when it finishes. */
  to: number;
  direction: SlideDirection;
  /**
   * Builds the arriving slide has taken from presses mid-flight. Only a flight
   * with no later slide to advance to records them; they land as its build step.
   */
  builds: number;
}

export interface SlideNavigationState {
  /** Committed slide. While a flight plays it is still the outgoing slide. */
  displayedIndex: number;
  /** Visible object build step on the displayed slide. */
  buildStep: number;
  /** Where the viewer is headed. Commands move this and nothing else. */
  targetIndex: number;
  flight: SlideFlight | null;
  flightSequence: number;
}

export interface SlideNavigationLayout {
  /** Object build steps per slide. */
  stepCounts: readonly number[];
  /** Transition each slide owns. See boundaryTransition for the boundaries it plays on. */
  transitions: readonly SlideTransitionType[];
}

export type SlideNavigationAction =
  | { type: "command"; command: SlideNavigationCommand }
  | { type: "flightFinished"; flightId: number }
  | { type: "seed"; index: number; targetIndex: number; buildStep: number };

/**
 * The slide that owns the boundary between two adjacent slides, for both its
 * transition and its speed. A boundary belongs to the later slide, so forward
 * N-1 to N and backward N to N-1 both use slide N, the backward one reversed.
 */
export function boundarySlideIndex(from: number, to: number): number {
  return Math.max(from, to);
}

export function boundaryTransition(
  transitions: readonly SlideTransitionType[],
  from: number,
  to: number,
): SlideTransitionType {
  return transitions[boundarySlideIndex(from, to)];
}

export function createSlideNavigation(index: number): SlideNavigationState {
  return {
    displayedIndex: index,
    buildStep: 0,
    targetIndex: index,
    flight: null,
    flightSequence: 0,
  };
}

function clampIndex(index: number, slideCount: number): number {
  if (slideCount <= 0) return 0;
  const safe = Number.isFinite(index) ? index : 0;
  return Math.max(0, Math.min(safe, slideCount - 1));
}

function entryBuildStep(
  layout: SlideNavigationLayout,
  index: number,
  direction: SlideDirection,
): number {
  // Stepping backward lands on a slide fully built, as navigation always has.
  return direction === "backward" ? layout.stepCounts[index] : 0;
}

/**
 * The build step the audience shows on the target slide: the live step while
 * the target is the displayed slide, else the step the target is entered with.
 */
export function targetBuildStep(
  state: SlideNavigationState,
  layout: SlideNavigationLayout,
): number {
  if (state.targetIndex === state.displayedIndex) return state.buildStep;
  const direction: SlideDirection =
    state.targetIndex > state.displayedIndex ? "forward" : "backward";
  return entryBuildStep(layout, state.targetIndex, direction);
}

/** A next press goes to the displayed slide's build steps before the deck advances. */
function nextConsumesBuildStep(
  state: SlideNavigationState,
  layout: SlideNavigationLayout,
): boolean {
  return (
    !state.flight &&
    state.targetIndex === state.displayedIndex &&
    state.buildStep < layout.stepCounts[state.displayedIndex]
  );
}

/** A prev press steps back through the displayed slide's builds before it leaves the slide. */
function prevConsumesBuildStep(state: SlideNavigationState): boolean {
  return (
    !state.flight &&
    state.targetIndex === state.displayedIndex &&
    state.buildStep > 0
  );
}

/** Builds the arriving slide still has to show, after the presses it already took. */
function arrivingBuildsLeft(
  flight: SlideFlight,
  layout: SlideNavigationLayout,
): number {
  return (
    layout.stepCounts[flight.to] -
    entryBuildStep(layout, flight.to, flight.direction) -
    flight.builds
  );
}

export function canCommand(
  state: SlideNavigationState,
  layout: SlideNavigationLayout,
  command: SlideNavigationCommand,
): boolean {
  if (command === "prev") {
    return state.targetIndex > 0 || prevConsumesBuildStep(state);
  }
  return (
    state.targetIndex < layout.stepCounts.length - 1 ||
    nextConsumesBuildStep(state, layout) ||
    (state.flight !== null && arrivingBuildsLeft(state.flight, layout) > 0)
  );
}

/**
 * Plays the next step toward the target: one slide per step. Instant (`none`)
 * entries commit in the same call; the first animated entry becomes the flight
 * and the loop stops until its flightFinished arrives.
 *
 * A press that arrives mid-flight counts as an advance past the arriving slide.
 * When that slide still has builds, those presses are its builds instead, and
 * they come first. Each press still moves exactly one step.
 */
function settle(
  state: SlideNavigationState,
  layout: SlideNavigationLayout,
  pressesBecomeBuilds: boolean,
): SlideNavigationState {
  let next = state;
  while (!next.flight && next.targetIndex !== next.displayedIndex) {
    const direction: SlideDirection =
      next.targetIndex > next.displayedIndex ? "forward" : "backward";
    if (direction === "forward" && pressesBecomeBuilds) {
      const pending = next.targetIndex - next.displayedIndex;
      const remaining = layout.stepCounts[next.displayedIndex] - next.buildStep;
      const consumed = Math.min(pending, remaining);
      if (consumed > 0) {
        next = {
          ...next,
          buildStep: next.buildStep + consumed,
          targetIndex: next.targetIndex - consumed,
        };
        continue;
      }
    }
    const to = next.displayedIndex + (direction === "forward" ? 1 : -1);
    if (
      boundaryTransition(layout.transitions, next.displayedIndex, to) === "none"
    ) {
      next = {
        ...next,
        displayedIndex: to,
        buildStep: entryBuildStep(layout, to, direction),
      };
    } else {
      const id = next.flightSequence + 1;
      next = {
        ...next,
        flight: { id, to, direction, builds: 0 },
        flightSequence: id,
      };
    }
  }
  return next;
}

export function reduceSlideNavigation(
  state: SlideNavigationState,
  action: SlideNavigationAction,
  layout: SlideNavigationLayout,
): SlideNavigationState {
  const slideCount = layout.stepCounts.length;
  switch (action.type) {
    case "command": {
      if (slideCount === 0) return state;
      if (action.command === "prev") {
        if (prevConsumesBuildStep(state)) {
          return { ...state, buildStep: state.buildStep - 1 };
        }
        const targetIndex = Math.max(0, state.targetIndex - 1);
        if (targetIndex === state.targetIndex) return state;
        return settle({ ...state, targetIndex }, layout, true);
      }
      if (nextConsumesBuildStep(state, layout)) {
        return { ...state, buildStep: state.buildStep + 1 };
      }
      const targetIndex = Math.min(slideCount - 1, state.targetIndex + 1);
      if (targetIndex === state.targetIndex) {
        // Nothing lies past the last slide, so a press mid-flight there takes a
        // build on the arriving slide, the same as a press that would advance.
        const flight = state.flight;
        if (flight && arrivingBuildsLeft(flight, layout) > 0) {
          return { ...state, flight: { ...flight, builds: flight.builds + 1 } };
        }
        return state;
      }
      return settle({ ...state, targetIndex }, layout, true);
    }
    case "flightFinished": {
      const flight = state.flight;
      // A finish from a flight that was since replaced or cancelled is stale.
      if (!flight || flight.id !== action.flightId) return state;
      return settle(
        {
          ...state,
          displayedIndex: flight.to,
          buildStep:
            entryBuildStep(layout, flight.to, flight.direction) + flight.builds,
          flight: null,
        },
        layout,
        true,
      );
    }
    case "seed": {
      if (slideCount === 0) return createSlideNavigation(0);
      const displayedIndex = clampIndex(action.index, slideCount);
      const targetIndex = clampIndex(action.targetIndex, slideCount);
      const buildStep = Math.max(
        0,
        Math.min(action.buildStep, layout.stepCounts[displayedIndex]),
      );
      if (
        displayedIndex === state.displayedIndex &&
        targetIndex === state.targetIndex &&
        buildStep === state.buildStep
      ) {
        return state;
      }
      return settle(
        {
          displayedIndex,
          buildStep,
          targetIndex,
          flight: null,
          flightSequence: state.flightSequence,
        },
        layout,
        false,
      );
    }
  }
}
