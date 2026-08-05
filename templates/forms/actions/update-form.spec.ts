import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockInvalidatePublicFormCache = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  existing: {
    id: "form-1",
    title: "Feedback",
    description: null,
    slug: "feedback-form-1",
    fields: JSON.stringify([
      { id: "message", type: "textarea", label: "Message", required: false },
    ]),
    settings: JSON.stringify({
      integrations: [
        {
          id: "slack-1",
          type: "slack",
          name: "Team Slack",
          enabled: true,
          url: "https://hooks.slack.com/services/example",
        },
      ],
      successMessage: "Thanks",
    }),
    status: "draft",
    visibility: "private",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    deletedAt: null,
  },
  updated: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", async () => ({
  ...(await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: mockInvalidatePublicFormCache,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [state.updated ?? state.existing],
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => {
        state.updated = { ...state.existing, ...updates };
        return { where: async () => {} };
      },
    }),
  }),
  schema: { forms: { id: "forms.id" } },
}));

const { default: updateForm } = await import("./update-form.js");

describe("update-form settings", () => {
  beforeEach(() => {
    state.updated = null;
    mockAssertAccess.mockClear();
    mockInvalidatePublicFormCache.mockClear();
  });

  it("merges partial settings without dropping integrations", async () => {
    const result = await updateForm.run({
      id: "form-1",
      settings: { emailOnNewResponses: true },
    });

    expect(result.settings).toEqual({
      integrations: [
        {
          id: "slack-1",
          type: "slack",
          name: "Team Slack",
          enabled: true,
          url: "https://hooks.slack.com/services/example",
        },
      ],
      successMessage: "Thanks",
      emailOnNewResponses: true,
    });
    expect(mockAssertAccess).toHaveBeenCalledWith("form", "form-1", "editor");
  });
});
