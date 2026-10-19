import { describe, expect, it } from "vitest";

import type { SlideTransitionType } from "../../../shared/slide-transitions";
import {
  boundarySlideIndex,
  boundaryTransition,
  canCommand,
  createSlideNavigation,
  reduceSlideNavigation,
  targetBuildStep,
  type SlideNavigationCommand,
  type SlideNavigationLayout,
  type SlideNavigationState,
} from "./slide-navigation";

function layout(
  transitions: SlideTransitionType[],
  stepCounts: number[] = transitions.map(() => 0),
): SlideNavigationLayout {
  return { transitions, stepCounts };
}

function command(
  state: SlideNavigationState,
  l: SlideNavigationLayout,
  name: SlideNavigationCommand,
  times = 1,
): SlideNavigationState {
  let next = state;
  for (let i = 0; i < times; i++) {
    next = reduceSlideNavigation(next, { type: "command", command: name }, l);
  }
  return next;
}

// Finishes the flight in progress, if any. Returns the state after it lands.
function finishFlight(
  state: SlideNavigationState,
  l: SlideNavigationLayout,
): SlideNavigationState {
  if (!state.flight) return state;
  return reduceSlideNavigation(
    state,
    { type: "flightFinished", flightId: state.flight.id },
    l,
  );
}

// Plays every flight to completion; returns the settled state and how many
// animated steps it took to get there.
function settle(
  state: SlideNavigationState,
  l: SlideNavigationLayout,
): { state: SlideNavigationState; steps: number } {
  let next = state;
  let steps = 0;
  while (next.flight) {
    next = finishFlight(next, l);
    steps += 1;
    if (steps > 100) throw new Error("navigation did not settle");
  }
  return { state: next, steps };
}

const dissolveDeck = (slideCount: number) =>
  layout(
    Array.from({ length: slideCount }, (): SlideTransitionType => "dissolve"),
  );

describe("slide navigation", () => {
  it("turns a burst of N presses into N steps", () => {
    const l = dissolveDeck(6);
    const burst = command(createSlideNavigation(0), l, "next", 4);

    const { state, steps } = settle(burst, l);

    expect(steps).toBe(4);
    expect(state.displayedIndex).toBe(4);
    expect(state.targetIndex).toBe(4);
  });

  it("clamps a burst at both ends of the deck", () => {
    const l = dissolveDeck(3);

    const forward = settle(command(createSlideNavigation(0), l, "next", 10), l);
    expect(forward.state.displayedIndex).toBe(2);
    expect(canCommand(forward.state, l, "next")).toBe(false);

    const back = settle(command(forward.state, l, "prev", 10), l);
    expect(back.state.displayedIndex).toBe(0);
    expect(canCommand(back.state, l, "prev")).toBe(false);
  });

  it("consumes build steps before the slide advances", () => {
    const l = layout(["none", "dissolve"], [2, 0]);
    const start = createSlideNavigation(0);

    const firstPress = command(start, l, "next");
    expect(firstPress.buildStep).toBe(1);
    expect(firstPress.flight).toBeNull();

    const secondPress = command(firstPress, l, "next");
    expect(secondPress.buildStep).toBe(2);
    expect(secondPress.flight).toBeNull();

    const thirdPress = command(secondPress, l, "next");
    expect(thirdPress.flight).toEqual({
      id: 1,
      to: 1,
      direction: "forward",
      builds: 0,
    });
    expect(thirdPress.displayedIndex).toBe(0);

    const landed = finishFlight(thirdPress, l);
    expect(landed.displayedIndex).toBe(1);
    expect(landed.buildStep).toBe(0);
  });

  it("lands backward fully built when a prev press leaves an unbuilt slide", () => {
    const l = layout(["none", "dissolve"], [2, 3]);

    const onFirstSlide = command(createSlideNavigation(0), l, "prev");
    expect(onFirstSlide.buildStep).toBe(0);
    expect(onFirstSlide.flight).toBeNull();

    const back = settle(command(createSlideNavigation(1), l, "prev"), l);
    expect(back.state.displayedIndex).toBe(0);
    expect(back.state.buildStep).toBe(2);
  });

  it("keeps a command that arrives mid-transition and plays it next", () => {
    const l = dissolveDeck(4);
    const started = command(createSlideNavigation(0), l, "next");
    expect(started.flight?.to).toBe(1);

    const queued = command(started, l, "next");
    expect(queued.flight?.to).toBe(1);
    expect(queued.targetIndex).toBe(2);

    const landed = finishFlight(queued, l);
    expect(landed.displayedIndex).toBe(1);
    expect(landed.flight).toEqual({
      id: 2,
      to: 2,
      direction: "forward",
      builds: 0,
    });
  });

  it("shows the arriving slide's build before a press that arrived mid-flight advances", () => {
    const l = layout(["none", "dissolve", "dissolve"], [0, 2, 0]);
    const started = command(createSlideNavigation(0), l, "next");
    const queued = command(started, l, "next");
    expect(queued.targetIndex).toBe(2);

    const landed = finishFlight(queued, l);
    expect(landed.displayedIndex).toBe(1);
    expect(landed.buildStep).toBe(1);
    expect(landed.targetIndex).toBe(1);
    expect(landed.flight).toBeNull();

    const secondBuild = command(landed, l, "next");
    expect(secondBuild.buildStep).toBe(2);
    expect(secondBuild.flight).toBeNull();

    const advance = command(secondBuild, l, "next");
    expect(advance.flight).toEqual({
      id: 2,
      to: 2,
      direction: "forward",
      builds: 0,
    });
  });

  it("offers and takes a mid-flight build when the flight lands on the last slide", () => {
    const l = layout(["none", "dissolve"], [0, 2]);
    const started = command(createSlideNavigation(0), l, "next");
    expect(started.flight?.to).toBe(1);
    expect(canCommand(started, l, "next")).toBe(true);

    const oneBuild = command(started, l, "next");
    expect(oneBuild.flight?.builds).toBe(1);
    expect(canCommand(oneBuild, l, "next")).toBe(true);

    const bothBuilds = command(oneBuild, l, "next");
    expect(bothBuilds.flight?.builds).toBe(2);
    expect(canCommand(bothBuilds, l, "next")).toBe(false);
    // One press per step: a press past the last build does nothing.
    expect(command(bothBuilds, l, "next")).toBe(bothBuilds);

    const landed = finishFlight(bothBuilds, l);
    expect(landed.displayedIndex).toBe(1);
    expect(landed.buildStep).toBe(2);
    expect(landed.flight).toBeNull();
    expect(canCommand(landed, l, "next")).toBe(false);
  });

  it("does not offer Next during a flight to a last slide with no builds", () => {
    const l = layout(["none", "dissolve"], [0, 0]);
    const started = command(createSlideNavigation(0), l, "next");

    expect(canCommand(started, l, "next")).toBe(false);
    expect(command(started, l, "next")).toBe(started);
  });

  it("counts every mid-flight press: the arriving slide's builds first, then the advance", () => {
    const l = layout(
      ["none", "dissolve", "dissolve", "none", "none"],
      [0, 2, 0, 0, 0],
    );
    const started = command(createSlideNavigation(0), l, "next");
    const queued = command(started, l, "next", 3);

    const landed = finishFlight(queued, l);
    expect(landed.displayedIndex).toBe(1);
    expect(landed.buildStep).toBe(2);
    expect(landed.flight).toEqual({
      id: 2,
      to: 2,
      direction: "forward",
      builds: 0,
    });
  });

  it("reverses a prev that arrives mid-transition once the flight lands", () => {
    const l = dissolveDeck(3);
    const started = command(createSlideNavigation(0), l, "next");
    const reversed = command(started, l, "prev");

    const { state, steps } = settle(finishFlight(reversed, l), l);

    expect(steps).toBe(1);
    expect(state.displayedIndex).toBe(0);
  });

  it("commits instant entries in the same press", () => {
    const l = layout(["none", "none", "none"]);

    const settled = command(createSlideNavigation(0), l, "next", 2);

    expect(settled.displayedIndex).toBe(2);
    expect(settled.flight).toBeNull();
  });

  it("stops at an animated entry after committing instant ones", () => {
    const l = layout(["none", "none", "dissolve", "none"]);

    const afterOne = command(createSlideNavigation(0), l, "next");
    expect(afterOne.displayedIndex).toBe(1);
    expect(afterOne.flight).toBeNull();

    const afterTwo = command(afterOne, l, "next");
    expect(afterTwo.displayedIndex).toBe(1);
    expect(afterTwo.flight?.to).toBe(2);

    const landed = finishFlight(afterTwo, l);
    expect(landed.displayedIndex).toBe(2);

    const afterThree = command(landed, l, "next");
    expect(afterThree.displayedIndex).toBe(3);
    expect(afterThree.flight).toBeNull();
  });

  it("ignores a finish from a flight that was already replaced", () => {
    const l = dissolveDeck(3);
    const started = command(createSlideNavigation(0), l, "next");

    const reseeded = reduceSlideNavigation(
      started,
      { type: "seed", index: 2, targetIndex: 2, buildStep: 0 },
      l,
    );
    const stale = reduceSlideNavigation(
      reseeded,
      { type: "flightFinished", flightId: started.flight?.id ?? -1 },
      l,
    );

    expect(stale).toBe(reseeded);
    expect(stale.displayedIndex).toBe(2);
  });

  it("a deep-link seed cancels the flight and resets the build step", () => {
    const l = dissolveDeck(4);
    const started = command(createSlideNavigation(0), l, "next");

    const seeded = reduceSlideNavigation(
      started,
      { type: "seed", index: 3, targetIndex: 3, buildStep: 0 },
      l,
    );

    expect(seeded.flight).toBeNull();
    expect(seeded.displayedIndex).toBe(3);
    expect(seeded.targetIndex).toBe(3);
  });

  it("leaves an in-progress flight alone when a seed changes nothing", () => {
    const l = dissolveDeck(4);
    const started = command(createSlideNavigation(0), l, "next");

    const unchanged = reduceSlideNavigation(
      started,
      { type: "seed", index: 0, targetIndex: 1, buildStep: 0 },
      l,
    );

    expect(unchanged).toBe(started);
  });
});

describe("targetBuildStep", () => {
  const cut = layout(["none", "none", "none"], [3, 2, 1]);

  it("reports the live build step while the target is the displayed slide", () => {
    const state: SlideNavigationState = {
      displayedIndex: 1,
      buildStep: 1,
      targetIndex: 1,
      flight: null,
      flightSequence: 0,
    };
    expect(targetBuildStep(state, cut)).toBe(1);
  });

  it("reports the entry step of a forward target: nothing built yet", () => {
    const state: SlideNavigationState = {
      displayedIndex: 0,
      buildStep: 3,
      targetIndex: 2,
      flight: null,
      flightSequence: 0,
    };
    expect(targetBuildStep(state, cut)).toBe(0);
  });

  it("reports a backward target's entry step: fully built", () => {
    const state: SlideNavigationState = {
      displayedIndex: 2,
      buildStep: 0,
      targetIndex: 1,
      flight: null,
      flightSequence: 0,
    };
    expect(targetBuildStep(state, cut)).toBe(2);
  });
});

describe("boundaryTransition", () => {
  const transitions: SlideTransitionType[] = ["none", "dissolve", "flip"];

  it("plays the later slide's transition on a forward boundary", () => {
    expect(boundaryTransition(transitions, 0, 1)).toBe("dissolve");
    expect(boundaryTransition(transitions, 1, 2)).toBe("flip");
  });

  it("plays the same later slide's transition on a backward boundary", () => {
    expect(boundaryTransition(transitions, 1, 0)).toBe("dissolve");
    expect(boundaryTransition(transitions, 2, 1)).toBe("flip");
  });
});

describe("boundarySlideIndex", () => {
  it("names the later slide for a boundary in either direction", () => {
    expect(boundarySlideIndex(0, 1)).toBe(1);
    expect(boundarySlideIndex(1, 0)).toBe(1);
    expect(boundarySlideIndex(2, 1)).toBe(2);
    expect(boundarySlideIndex(1, 2)).toBe(2);
  });
});

describe("transition selection at a boundary", () => {
  it("plays a forward flight when the entered slide's transition is animated", () => {
    const flight = reduceSlideNavigation(
      createSlideNavigation(0),
      { type: "command", command: "next" },
      layout(["none", "dissolve"]),
    ).flight;

    expect(flight).toEqual({ id: 1, to: 1, direction: "forward", builds: 0 });
  });

  it("commits a backward step instantly when the later slide has no transition, though the earlier one is animated", () => {
    // Index 1 is "none", so going back across the 0-1 boundary is instant.
    // The entered slide (index 0) is animated, which the old rule would fly.
    const back = reduceSlideNavigation(
      createSlideNavigation(1),
      { type: "command", command: "prev" },
      layout(["dissolve", "none"]),
    );

    expect(back.flight).toBeNull();
    expect(back.displayedIndex).toBe(0);
  });

  it("flies a backward step when the later slide is animated, though the entered slide has none", () => {
    // Index 1 is "dissolve", so going back across the 0-1 boundary flies.
    // The entered slide (index 0) is "none", which the old rule would cut.
    const back = reduceSlideNavigation(
      createSlideNavigation(1),
      { type: "command", command: "prev" },
      layout(["none", "dissolve"]),
    );

    expect(back.flight).toEqual({
      id: 1,
      to: 0,
      direction: "backward",
      builds: 0,
    });
  });
});
