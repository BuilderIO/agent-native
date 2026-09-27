// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  googleStatus: {
    data: undefined as { accounts: { email: string }[] } | undefined,
    isLoading: false,
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/GoogleConnectBanner", () => ({
  GoogleConnectBanner: () => <div data-testid="gmail-connect" />,
}));

vi.mock("./AiInboxSetup", () => ({
  AiInboxSetup: () => <div data-testid="mail-triage-setup" />,
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => mocks.googleStatus,
}));

import { listFirstRunOnboardingExtensions } from "@agent-native/core/client/onboarding";

import { MailTriageFirstRun } from "./register-first-run";

beforeEach(() => {
  mocks.googleStatus.data = undefined;
  mocks.googleStatus.isLoading = false;
});

afterEach(() => cleanup());

it("registers Mail triage after core first-run onboarding", () => {
  expect(listFirstRunOnboardingExtensions()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "mail-triage" })]),
  );
});

it("offers Gmail connection or skip instead of a blank setup step", () => {
  const onSkip = vi.fn();
  render(<MailTriageFirstRun onComplete={vi.fn()} onSkip={onSkip} />);

  expect(screen.getByTestId("gmail-connect")).not.toBeNull();
  expect(screen.queryByTestId("mail-triage-setup")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "mail.sort.aiSetupSkipSetup" }),
  );
  expect(onSkip).toHaveBeenCalledOnce();
});

it("shows the shared triage flow when Gmail is already connected", () => {
  mocks.googleStatus.data = {
    accounts: [{ email: "mail-test@example.test" }],
  };
  render(<MailTriageFirstRun onComplete={vi.fn()} onSkip={vi.fn()} />);

  expect(screen.getByTestId("mail-triage-setup")).not.toBeNull();
  expect(screen.queryByTestId("gmail-connect")).toBeNull();
});
