// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./AiInboxSetup", () => ({
  AiInboxSetup: ({
    embedded,
    forceOpen,
    firstRunStage,
    onComplete,
    onSkip,
    onStepChange,
  }: {
    embedded: boolean;
    forceOpen: boolean;
    firstRunStage: "preferences" | "sorting";
    onComplete: () => void;
    onSkip: () => void;
    onStepChange?: (stepIndex: number) => void;
  }) => (
    <div
      data-testid="mail-triage-setup"
      data-embedded={String(embedded)}
      data-force-open={String(forceOpen)}
      data-stage={firstRunStage}
      data-has-complete={String(typeof onComplete === "function")}
      data-has-skip={String(typeof onSkip === "function")}
      data-has-step-change={String(typeof onStepChange === "function")}
    />
  ),
}));

import { listFirstRunOnboardingExtensions } from "@agent-native/core/client/onboarding";

import { MailTriageFirstRun, MailTriageSorting } from "./register-first-run";

afterEach(() => cleanup());

it("registers Mail preferences before setup and sorting after Builder setup", () => {
  expect(listFirstRunOnboardingExtensions()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "mail-triage-preferences",
        placement: "before-setup",
        stepCount: 3,
      }),
      expect.objectContaining({
        id: "mail-triage-sorting",
        placement: "after-setup",
        stepCount: 1,
      }),
    ]),
  );
});

it("uses the preferences stage before provider setup", () => {
  render(
    <MailTriageFirstRun
      onComplete={vi.fn()}
      onSkip={vi.fn()}
      onStepChange={vi.fn()}
    />,
  );

  const setup = screen.getByTestId("mail-triage-setup");
  expect(setup.getAttribute("data-embedded")).toBe("true");
  expect(setup.getAttribute("data-force-open")).toBe("true");
  expect(setup.getAttribute("data-stage")).toBe("preferences");
  expect(setup.getAttribute("data-has-complete")).toBe("true");
  expect(setup.getAttribute("data-has-skip")).toBe("true");
  expect(setup.getAttribute("data-has-step-change")).toBe("true");
});

it("uses a separate embedded sorting stage after provider setup", () => {
  render(<MailTriageSorting onComplete={vi.fn()} onSkip={vi.fn()} />);

  const setup = screen.getByTestId("mail-triage-setup");
  expect(setup.getAttribute("data-stage")).toBe("sorting");
  expect(setup.getAttribute("data-has-complete")).toBe("true");
});
