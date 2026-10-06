import { describe, expect, it } from "vitest";

import {
  isNewDeckGenerationFailed,
  nextNewDeckGenerationPhase,
  shouldClearNewDeckGeneratingState,
  shouldClearNewDeckGenerationRun,
  shouldShowNewDeckGeneratingOverlay,
  shouldShowNewDeckGeneratingProgress,
  slideBeingFilledInPlace,
} from "./generation-state";

describe("new deck generation state", () => {
  const base = {
    slideCount: 0,
    hasGenerationContext: true,
    failureCode: undefined,
    isNewDeckCreation: false,
    phase: "started" as const,
    generating: false,
    waitingOnQuestions: false,
  };

  it("fails a generation whose run ended without a slide", () => {
    expect(isNewDeckGenerationFailed(base)).toBe(true);
  });

  it("fails a generation that never started", () => {
    expect(
      isNewDeckGenerationFailed({
        ...base,
        isNewDeckCreation: true,
        phase: "abandoned",
      }),
    ).toBe(true);
  });

  it("keeps waiting while the run is live, questions are open, or slides exist", () => {
    expect(isNewDeckGenerationFailed({ ...base, generating: true })).toBe(
      false,
    );
    expect(
      isNewDeckGenerationFailed({ ...base, waitingOnQuestions: true }),
    ).toBe(false);
    expect(isNewDeckGenerationFailed({ ...base, slideCount: 2 })).toBe(false);
    expect(
      isNewDeckGenerationFailed({
        ...base,
        isNewDeckCreation: true,
        phase: "pending",
      }),
    ).toBe(false);
  });

  it("keeps stale failure metadata from hiding active or question-waiting progress", () => {
    expect(
      isNewDeckGenerationFailed({
        ...base,
        failureCode: "agent_error",
        generating: true,
      }),
    ).toBe(false);
    expect(
      isNewDeckGenerationFailed({
        ...base,
        failureCode: "agent_error",
        waitingOnQuestions: true,
      }),
    ).toBe(false);
  });

  it("does not call a reopened, unprompted empty deck a failure", () => {
    expect(isNewDeckGenerationFailed({ ...base, phase: "pending" })).toBe(
      false,
    );
    expect(
      isNewDeckGenerationFailed({ ...base, hasGenerationContext: false }),
    ).toBe(false);
    expect(
      isNewDeckGenerationFailed({
        ...base,
        phase: "pending",
        failureCode: "agent_error",
      }),
    ).toBe(true);
  });

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

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: null,
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();

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
