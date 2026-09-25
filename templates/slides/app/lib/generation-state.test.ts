import { describe, expect, it } from "vitest";

import {
  nextNewDeckGenerationPhase,
  shouldClearNewDeckGeneratingState,
  shouldClearNewDeckGenerationRun,
  shouldShowNewDeckGeneratingOverlay,
  shouldShowNewDeckGeneratingProgress,
  slideBeingFilledInPlace,
} from "./generation-state";

describe("new deck generation state", () => {
  it("shows the blocking overlay before and during the first slide", () => {
    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 0,
        phase: "started",
      }),
    ).toBe(true);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 1,
        phase: "started",
      }),
    ).toBe(false);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: false,
        isNewDeckCreation: true,
        slideCount: 0,
        phase: "started",
      }),
    ).toBe(false);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: false,
        isNewDeckCreation: true,
        slideCount: 0,
        phase: "pending",
      }),
    ).toBe(true);
  });

  it("keeps creation intent until generation starts", () => {
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: false,
        phase: "pending",
      }),
    ).toBe(false);
  });

  it("keeps progress visible after the first slide lands", () => {
    expect(
      shouldShowNewDeckGeneratingProgress({
        generating: true,
        isNewDeckCreation: true,
      }),
    ).toBe(true);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: true,
        waitingOnQuestions: false,
        phase: "started",
      }),
    ).toBe(false);
  });

  it("names the placeholder the agent fills instead of adding a generating row", () => {
    const BLANK = "<blank>";
    const slides = [
      { id: "slide-1", content: "real content" },
      { id: "slide-2", content: BLANK },
      { id: "slide-3", content: "real content" },
    ];

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slides,
        blankContent: BLANK,
      }),
    ).toBe("slide-2");

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: false,
        addSlideTargetId: "slide-2",
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();

    // Agent appends a net-new slide: no placeholder to light up.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: null,
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();

    // Placeholder deleted mid-run.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slides: [
          { id: "slide-1", content: "real content" },
          { id: "slide-3", content: "real content" },
        ],
        blankContent: BLANK,
      }),
    ).toBeNull();

    // The agent has already written real content: the fill is done, so a
    // follow-up `add-slide` for the rest of a multi-slide request gets the
    // trailing generating row again instead of staying suppressed.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-1",
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();
  });

  it("clears new-deck generating state once a run that started stops", () => {
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: false,
        phase: "started",
      }),
    ).toBe(true);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: false,
        phase: "pending",
      }),
    ).toBe(false);
  });

  it("keeps run correlation after timeout until generation actually finishes", () => {
    const abandoned = {
      generating: false,
      waitingOnQuestions: false,
      phase: "abandoned" as const,
    };
    expect(shouldClearNewDeckGeneratingState(abandoned)).toBe(true);
    expect(shouldClearNewDeckGenerationRun(abandoned)).toBe(false);
    expect(
      shouldClearNewDeckGenerationRun({
        ...abandoned,
        phase: "started" as const,
      }),
    ).toBe(true);
  });

  describe("nextNewDeckGenerationPhase", () => {
    it("reloading a dead ?generating=1 deck (no run, no questions) abandons after the wait lapses, and that clears the stuck state", () => {
      // A page load that never observes a run and isn't blocked on
      // questions must eventually leave "pending" — otherwise the overlay
      // and the url param that re-seeds it persist forever.
      const phase = nextNewDeckGenerationPhase({
        phase: "pending",
        generating: false,
        waitingOnQuestions: false,
        waitExpired: true,
      });
      expect(phase).toBe("abandoned");
      expect(
        shouldShowNewDeckGeneratingOverlay({
          generating: false,
          isNewDeckCreation: true,
          slideCount: 0,
          phase,
        }),
      ).toBe(false);
      expect(
        shouldClearNewDeckGeneratingState({
          generating: false,
          waitingOnQuestions: false,
          phase,
        }),
      ).toBe(true);
    });

    it("does not abandon while the wait window hasn't lapsed yet", () => {
      expect(
        nextNewDeckGenerationPhase({
          phase: "pending",
          generating: false,
          waitingOnQuestions: false,
          waitExpired: false,
        }),
      ).toBe("pending");
    });

    it("survives an expired wait while pre-generation questions are pending", () => {
      // Intent can legitimately arrive after mount, through the question
      // flow the empty editor shows — the wait must not lapse underneath it
      // even once the plain time bound would otherwise have expired.
      const phase = nextNewDeckGenerationPhase({
        phase: "pending",
        generating: false,
        waitingOnQuestions: true,
        waitExpired: true,
      });
      expect(phase).toBe("pending");
      expect(
        shouldShowNewDeckGeneratingOverlay({
          generating: false,
          isNewDeckCreation: true,
          slideCount: 0,
          phase,
        }),
      ).toBe(true);
      expect(
        shouldClearNewDeckGeneratingState({
          generating: false,
          waitingOnQuestions: true,
          phase,
        }),
      ).toBe(false);
    });

    it("moves to started as soon as a run is observed, even mid-wait", () => {
      expect(
        nextNewDeckGenerationPhase({
          phase: "pending",
          generating: true,
          waitingOnQuestions: false,
          waitExpired: false,
        }),
      ).toBe("started");
    });

    it("normal path: once started, later expiry inputs are ignored, and clearing waits for generating to stop", () => {
      const started = nextNewDeckGenerationPhase({
        phase: "pending",
        generating: true,
        waitingOnQuestions: false,
        waitExpired: false,
      });
      expect(started).toBe("started");

      // Terminal: further calls (e.g. `generating` flickering, a stray
      // expiry) never move it back to pending or to abandoned.
      expect(
        nextNewDeckGenerationPhase({
          phase: started,
          generating: false,
          waitingOnQuestions: false,
          waitExpired: true,
        }),
      ).toBe("started");

      expect(
        shouldClearNewDeckGeneratingState({
          generating: true,
          waitingOnQuestions: false,
          phase: started,
        }),
      ).toBe(false);
      expect(
        shouldClearNewDeckGeneratingState({
          generating: false,
          waitingOnQuestions: false,
          phase: started,
        }),
      ).toBe(true);
    });

    it("revives an abandoned route when a run starts late", () => {
      expect(
        nextNewDeckGenerationPhase({
          phase: "abandoned",
          generating: true,
          waitingOnQuestions: false,
          waitExpired: false,
        }),
      ).toBe("started");
      expect(
        shouldClearNewDeckGeneratingState({
          generating: true,
          waitingOnQuestions: false,
          phase: "abandoned",
        }),
      ).toBe(false);
      expect(
        nextNewDeckGenerationPhase({
          phase: "abandoned",
          generating: false,
          waitingOnQuestions: false,
          waitExpired: false,
        }),
      ).toBe("abandoned");
    });
  });
});
