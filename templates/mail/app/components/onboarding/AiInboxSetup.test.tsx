// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRule: vi.fn(),
  updateSettings: vi.fn(),
  jevAvailability: {
    data: undefined as { configured: boolean } | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => mocks.jevAvailability,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/settings/JevConnectionPrompt", () => ({
  JevConnectionPrompt: () => null,
  JevAvailabilityError: ({ onRetry }: { onRetry: () => void }) => (
    <button type="button" onClick={onRetry}>
      mail.error.tryAgain
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({ data: [], isLoading: false }),
  useCreateAutomation: () => ({ mutateAsync: mocks.createRule }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useLabels: () => ({ data: [] }),
  useSettings: () => ({ data: { aiSetupCompleted: false, pinnedLabels: [] } }),
  useUpdateSettings: () => ({ mutateAsync: mocks.updateSettings }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({
    data: { accounts: [{ email: "mail-test@example.test" }] },
    isLoading: false,
  }),
}));

import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";

import { AiInboxSetup } from "./AiInboxSetup";

describe("AiInboxSetup", () => {
  beforeEach(() => {
    mocks.createRule.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);
    Object.assign(mocks.jevAvailability, {
      data: { configured: true },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not create archive or spam rules when Done is clicked on the untouched skip-inbox step", async () => {
    render(<AiInboxSetup forceOpen />);

    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagReceipts" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagGitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "mail.sort.aiSetupTagUpdates" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupTagReceipts" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupTagGitHub" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupContinue" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", {
          name: "mail.sort.aiSetupImportantHeadline",
        }),
      ).not.toBeNull();
    });
    const continueButton = screen.getByRole("button", {
      name: "mail.sort.aiSetupContinue",
    });
    await waitFor(() => {
      expect((continueButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(continueButton);

    const archivePrompt = await screen.findByPlaceholderText(
      "mail.aiFilter.archivePlaceholder",
    );
    const spamPrompt = await screen.findByPlaceholderText(
      "mail.aiFilter.spamPlaceholder",
    );
    expect((archivePrompt as HTMLTextAreaElement).value).toBe("");
    expect((spamPrompt as HTMLTextAreaElement).value).toBe("");

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupDone" }),
    );

    await waitFor(() => expect(mocks.createRule).toHaveBeenCalledTimes(1));
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: "mail.sort.aiSetupImportantPrompt",
        actions: [{ type: "label", labelName: AI_IMPORTANT_LABEL }],
      }),
    );
  });

  it("shows retry instead of a connect prompt when Jev availability cannot be checked", async () => {
    Object.assign(mocks.jevAvailability, {
      data: undefined,
      isError: true,
    });
    render(<AiInboxSetup forceOpen />);

    expect(
      await screen.findByRole("heading", {
        name: "mail.aiFilter.jevAvailabilityFailed",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "mail.error.tryAgain" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "mail.aiFilter.connectBuilder" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mail.error.tryAgain" }),
    );
    expect(mocks.jevAvailability.refetch).toHaveBeenCalledOnce();
  });
});
