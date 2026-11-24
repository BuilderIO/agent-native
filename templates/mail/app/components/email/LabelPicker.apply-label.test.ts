// @vitest-environment happy-dom

import type { EmailMessage } from "@shared/types";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutations = vi.hoisted(() => ({
  create: vi.fn(),
  label: vi.fn(),
  move: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/hooks/use-emails", () => ({
  LabelEmailPartialFailure: class LabelEmailPartialFailure extends Error {},
  MoveEmailPartialFailure: class MoveEmailPartialFailure extends Error {},
  useCreateLabel: () => ({ mutateAsync: mutations.create }),
  useLabelEmail: () => ({ mutateAsync: mutations.label }),
  useMoveEmail: () => ({ mutateAsync: mutations.move }),
}));

import { useApplyLabel } from "./LabelPicker";

const rows = [
  { id: "m1", threadId: "t1", accountEmail: "work@example.com" },
  { id: "m2", threadId: "", accountEmail: "home@example.com" },
] as EmailMessage[];
const clients = { id: "clients", name: "Clients", isNew: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useApplyLabel", () => {
  it("passes selected account and thread provenance for every moved row", async () => {
    mutations.move.mockResolvedValue({ succeeded: ["m1", "m2"] });
    const { result } = renderHook(() => useApplyLabel("receipts"));

    await result.current("move", clients, rows);

    expect(mutations.move).toHaveBeenCalledTimes(1);
    expect(mutations.move).toHaveBeenCalledWith({
      id: "m1,m2",
      label: "clients",
      removeLabel: "receipts",
      accountEmails: "work@example.com,home@example.com",
      threadIds: "t1,m2",
    });
    expect(mutations.label).not.toHaveBeenCalled();
  });

  it("labels with the same provenance and removes nothing", async () => {
    mutations.label.mockResolvedValue({ succeeded: ["m1", "m2"] });
    const { result } = renderHook(() => useApplyLabel("receipts"));

    await result.current("label", clients, rows);

    expect(mutations.label).toHaveBeenCalledWith({
      id: "m1,m2",
      label: "clients",
      accountEmails: "work@example.com,home@example.com",
      threadIds: "t1,m2",
    });
    expect(mutations.move).not.toHaveBeenCalled();
  });
});
