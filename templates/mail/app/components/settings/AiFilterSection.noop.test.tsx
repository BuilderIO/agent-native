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
  consolidateRule: vi.fn(),
  deleteRule: vi.fn(),
  updateRule: vi.fn(),
  updatePreferences: vi.fn(),
  includeTagRule: false,
  includeDisabledImportant: false,
  includeExtraDuplicate: false,
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
    const disabledImportantRule = {
      id: "important-rule-disabled",
      ownerEmail: "mail-test@example.test",
      domain: "mail",
      kind: "ai-filter",
      name: "Disabled important rule",
      condition: "Do not include this instruction",
      actions: [{ type: "label", labelName: "agent-native-important" }],
      enabled: false,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
    };
    const extraDuplicate = {
      ...data[1],
      id: "important-rule-duplicate-2",
      condition: "Another active instruction",
    };
    const tagRule = {
      id: "tag-rule",
      ownerEmail: "mail-test@example.test",
      domain: "mail",
      kind: "ai-filter",
      name: "AI tag: GitHub receipts",
      condition: "GitHub receipts",
      actions: [{ type: "label", labelName: "Existing tag" }],
      enabled: true,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
    };
    const dataWithDisabledImportant = [...data, disabledImportantRule];
    const dataWithExtraDuplicate = [...data, extraDuplicate];
    const dataWithTag = [...data, tagRule];
    return () => ({
      data: mocks.includeExtraDuplicate
        ? dataWithExtraDuplicate
        : mocks.includeDisabledImportant
          ? dataWithDisabledImportant
          : mocks.includeTagRule
            ? dataWithTag
            : data,
      isLoading: false,
    });
  })(),
  useCreateAutomation: () => ({ mutateAsync: mocks.createRule }),
  useConsolidateAiFilterRules: () => ({
    mutateAsync: mocks.consolidateRule,
  }),
  useDeleteAutomation: () => ({ mutateAsync: mocks.deleteRule }),
  useUpdateAutomation: () => ({ mutateAsync: mocks.updateRule }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useLabels: () => ({ data: [] }),
  useSettings: () => ({ data: { pinnedLabels: [] } }),
  useUpdateSettings: () => ({ mutateAsync: mocks.updatePreferences }),
}));

vi.mock("@/hooks/use-google-auth", () => ({
  useGoogleAuthStatus: () => ({ data: { accounts: [] } }),
}));

import { AiFilterSection } from "./AiFilterSection";

describe("AiFilterSection prompt blur saves", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.includeTagRule = false;
    mocks.includeDisabledImportant = false;
    mocks.includeExtraDuplicate = false;
    mocks.createRule.mockReset();
    mocks.consolidateRule.mockReset();
    mocks.deleteRule.mockReset();
    mocks.updateRule.mockReset();
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

  it("keeps disabled instructions out of prompt edits", async () => {
    mocks.includeDisabledImportant = true;
    mocks.consolidateRule.mockResolvedValue({ saved: true });
    render(<AiFilterSection />);

    const prompt = screen.getByRole("textbox", {
      name: "mail.aiFilter.importantMode",
    });
    expect((prompt as HTMLTextAreaElement).value).toBe(
      "Human comments on GitHub matter\nImportant customer conversations",
    );

    fireEvent.change(prompt, { target: { value: "Only active rules apply" } });
    fireEvent.blur(prompt);

    await waitFor(() => {
      expect(mocks.consolidateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "important-rule",
          duplicateIds: ["important-rule-duplicate"],
          condition: "Only active rules apply",
        }),
      );
    });
    expect(mocks.updateRule).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "important-rule-disabled" }),
    );
    expect(mocks.deleteRule).not.toHaveBeenCalledWith(
      "important-rule-disabled",
    );
    expect(mocks.deleteRule).not.toHaveBeenCalled();
  });

  it("consolidates prompt rules in one mutation", async () => {
    mocks.includeExtraDuplicate = true;
    mocks.consolidateRule.mockResolvedValue({ saved: true });
    render(<AiFilterSection />);

    const prompt = screen.getByRole("textbox", {
      name: "mail.aiFilter.importantMode",
    });
    fireEvent.change(prompt, { target: { value: "Updated instruction" } });
    fireEvent.blur(prompt);

    await waitFor(() => {
      expect(mocks.consolidateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "important-rule",
          duplicateIds: [
            "important-rule-duplicate",
            "important-rule-duplicate-2",
          ],
          name: "AI important: Updated instruction",
          condition: "Updated instruction",
          actions: [{ type: "label", labelName: "agent-native-important" }],
        }),
      );
    });
    expect(mocks.updateRule).not.toHaveBeenCalled();
    expect(mocks.deleteRule).not.toHaveBeenCalled();
  });

  it("does not patch tags when trimmed drafts match the saved rule", async () => {
    mocks.includeTagRule = true;
    render(<AiFilterSection />);

    fireEvent.click(screen.getByRole("button", { name: /Existing tag/ }));
    const name = screen.getByRole("textbox", {
      name: "mail.aiFilter.tagNamePlaceholder",
    });
    const condition = screen.getByRole("textbox", {
      name: "mail.aiFilter.tagPlaceholder",
    });
    fireEvent.change(name, { target: { value: " Existing tag " } });
    fireEvent.change(condition, { target: { value: " GitHub receipts " } });
    fireEvent.blur(name);
    fireEvent.blur(condition);

    await waitFor(() => {
      expect(mocks.updateRule).not.toHaveBeenCalled();
      expect(mocks.updatePreferences).not.toHaveBeenCalled();
    });
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
