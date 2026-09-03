import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockInvalidatePublicFormCache = vi.hoisted(() => vi.fn());
const mockWithFormLock = vi.hoisted(() =>
  vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
);
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
  returnStaleAfterWrite: false,
  writeConflict: false,
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
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
}));

vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: mockInvalidatePublicFormCache,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            state.returnStaleAfterWrite
              ? state.existing
              : (state.updated ?? state.existing),
          ],
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => {
        state.updated = { ...state.existing, ...updates };
        return {
          where: () => ({
            returning: async () => {
              if (state.writeConflict) {
                state.updated = null;
                return [];
              }
              return [{ id: "form-1" }];
            },
          }),
        };
      },
    }),
  }),
  schema: {
    forms: {
      id: "forms.id",
      fields: "forms.fields",
      updatedAt: "forms.updatedAt",
    },
  },
}));

vi.mock("./patch-form-fields.js", () => ({
  withFormLock: mockWithFormLock,
}));

const { default: updateForm } = await import("./update-form.js");

describe("update-form settings", () => {
  beforeEach(() => {
    state.updated = null;
    state.returnStaleAfterWrite = false;
    state.writeConflict = false;
    state.existing.status = "draft";
    mockAssertAccess.mockClear();
    mockInvalidatePublicFormCache.mockClear();
    mockWithFormLock.mockClear();
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
    expect(mockWithFormLock).toHaveBeenCalledWith(
      "form-1",
      expect.any(Function),
    );
  });

  it("returns written fields without trusting a stale post-write read", async () => {
    state.returnStaleAfterWrite = true;
    const fields = [
      {
        id: "message",
        type: "textarea",
        label: "Message",
        placeholder: "Tell us what you think",
        required: false,
      },
    ];

    const result = await updateForm.run({
      id: "form-1",
      fields,
    });

    expect(result.fields).toEqual(fields);
    expect(mockInvalidatePublicFormCache).toHaveBeenCalledWith(
      state.existing,
      expect.objectContaining({ fields: JSON.stringify(fields) }),
    );
  });

  it("validates field replacements on an already-published form", async () => {
    state.existing.status = "published";

    await expect(updateForm.run({ id: "form-1", fields: [] })).rejects.toThrow(
      "Cannot publish",
    );
    expect(state.updated).toBeNull();
  });

  it("rejects a stale write when another instance changes the form first", async () => {
    state.writeConflict = true;

    await expect(
      updateForm.run({
        id: "form-1",
        fields: [
          {
            id: "message",
            type: "textarea",
            label: "Updated message",
            required: false,
          },
        ],
      }),
    ).rejects.toThrow("changed while this update was in progress");
    expect(state.updated).toBeNull();
  });
});
