// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRule: vi.fn(),
  deleteRule: vi.fn(),
  updateRule: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/onboarding/AiInboxSetup", () => ({
  AiInboxSetup: () => null,
  TAG_SUGGESTIONS: [
    [
      "receipts",
      "mail.sort.aiSetupTagReceipts",
      "mail.sort.aiSetupPromptReceipts",
    ],
    [
      "updates",
      "mail.sort.aiSetupTagUpdates",
      "mail.sort.aiSetupPromptUpdates",
    ],
    ["github", "mail.sort.aiSetupTagGitHub", "mail.sort.aiSetupPromptGitHub"],
  ],
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/use-ai-filter", () => ({
  useAiFilter: () => ({ data: { enabled: true }, isLoading: false }),
  useManageAiFilter: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: (() => {
    const data = [
      {
        id: "important-rule",
        ownerEmail: "mail-test@example.test",
        domain: "mail",
        kind: "ai-filter",
        name: "AI important",
        condition: "Human comments on GitHub matter",
        actions: [{ type: "label", labelName: "agent-native-important" }],
        enabled: true,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
      {
        id: "important-rule-duplicate",
        ownerEmail: "mail-test@example.test",
        domain: "mail",
        kind: "ai-filter",
        name: "AI important: customers",
        condition: "Important customer conversations",
        actions: [{ type: "label", labelName: "agent-native-important" }],
        enabled: true,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    ];
    return () => ({ data, isLoading: false });
  })(),
  useCreateAutomation: () => ({ mutateAsync: mocks.createRule }),
  useDeleteAutomation: () => ({ mutateAsync: mocks.deleteRule }),
  useUpdateAutomation: () => ({ mutateAsync: mocks.updateRule }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useLabels: () => ({ data: [] }),
  useSettings: () => ({ data: { pinnedLabels: [] } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({ data: { accounts: [] } }),
}));

import { AiFilterSection } from "./AiFilterSection";

describe("AiFilterSection prompt blur saves", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not mutate existing rules when a prompt blurs unchanged", async () => {
    render(<AiFilterSection />);

    const prompt = screen.getByRole("textbox", {
      name: "mail.aiFilter.importantMode",
    });
    await waitFor(() => {
      expect((prompt as HTMLTextAreaElement).value).toBe(
        "Human comments on GitHub matter\nImportant customer conversations",
      );
    });

    fireEvent.blur(prompt);

    await waitFor(() => {
      expect(mocks.createRule).not.toHaveBeenCalled();
      expect(mocks.updateRule).not.toHaveBeenCalled();
      expect(mocks.deleteRule).not.toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", { name: "mail.sort.aiSetupRunAgain" }),
    ).toBeNull();
  });

  it("adds a suggested tag from one click", async () => {
    render(<AiFilterSection />);

    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.aiSetupTagReceipts" }),
    );

    await waitFor(() => {
      expect(mocks.createRule).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: "mail.sort.aiSetupPromptReceipts",
          actions: [
            {
              type: "label",
              labelName: "mail.sort.aiSetupTagReceipts",
            },
          ],
          kind: "ai-filter",
          domain: "mail",
        }),
      );
    });
  });
});
