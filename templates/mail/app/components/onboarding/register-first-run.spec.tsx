// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./AiInboxSetup", () => ({
  AiInboxSetup: ({
    embedded,
    forceOpen,
    onComplete,
    onSkipSetup,
  }: {
    embedded: boolean;
    forceOpen: boolean;
    onComplete: () => void;
    onSkipSetup: () => void;
  }) => (
    <div
      data-testid="mail-triage-setup"
      data-embedded={String(embedded)}
      data-force-open={String(forceOpen)}
      data-has-complete={String(typeof onComplete === "function")}
      data-has-skip={String(typeof onSkipSetup === "function")}
    />
  ),
}));

import { listFirstRunOnboardingExtensions } from "@agent-native/core/client/onboarding";

import { MailTriageFirstRun } from "./register-first-run";

afterEach(() => cleanup());

it("registers Mail triage after core first-run onboarding", () => {
  expect(listFirstRunOnboardingExtensions()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "mail-triage" })]),
  );
});

it("uses the same embedded triage flow for first-run setup", () => {
  render(<MailTriageFirstRun onComplete={vi.fn()} onSkip={vi.fn()} />);

  const setup = screen.getByTestId("mail-triage-setup");
  expect(setup.getAttribute("data-embedded")).toBe("true");
  expect(setup.getAttribute("data-force-open")).toBe("true");
  expect(setup.getAttribute("data-has-complete")).toBe("true");
  expect(setup.getAttribute("data-has-skip")).toBe("true");
});
