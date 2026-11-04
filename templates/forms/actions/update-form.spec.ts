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

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
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
const { fieldsRevision } = await import("../server/lib/merge-fields.js");

describe("update-form settings", () => {
  beforeEach(() => {
    state.updated = null;
    state.returnStaleAfterWrite = false;
    state.writeConflict = false;
    state.existing.status = "draft";
    state.existing.slug = "feedback-form-1";
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
      expectedRevision: fieldsRevision(state.existing.fields),
      fields,
    });

    expect(result.fields).toEqual(fields);
    expect(mockInvalidatePublicFormCache).toHaveBeenCalledWith(
      state.existing,
      expect.objectContaining({ fields: expect.any(String) }),
    );
    const [, written] = mockInvalidatePublicFormCache.mock.calls.at(-1)!;
    expect(JSON.parse((written as { fields: string }).fields)).toEqual(fields);
  });

  it("validates field replacements on an already-published form", async () => {
    state.existing.status = "published";

    await expect(
      updateForm.run({
        id: "form-1",
        expectedRevision: fieldsRevision(state.existing.fields),
        fields: [],
      }),
    ).rejects.toThrow("Cannot publish");
    expect(state.updated).toBeNull();
  });

  it("rejects a stale write when another instance changes the form first", async () => {
    state.writeConflict = true;

    await expect(
      updateForm.run({
        id: "form-1",
        expectedRevision: fieldsRevision(state.existing.fields),
        fields: [
          {
            id: "message",
            type: "textarea",
            label: "Updated message",
            required: false,
          },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "save_conflict",
      details: {
        current: JSON.parse(state.existing.fields),
        currentRevision: fieldsRevision(state.existing.fields),
      },
    });
    expect(state.updated).toBeNull();
  });

  it("doesn't report a fields conflict when a rename loses the race", async () => {
    state.writeConflict = true;

    await expect(
      updateForm.run({ id: "form-1", title: "Renamed" }),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "form_changed" });
    expect(state.updated).toBeNull();
  });

  it("refuses to replace the fields without the revision it read", async () => {
    await expect(
      updateForm.run({ id: "form-1", fields: [] }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(state.updated).toBeNull();
  });

  it("refuses to replace fields that changed after the read", async () => {
    await expect(
      updateForm.run({
        id: "form-1",
        expectedRevision: fieldsRevision("[]"),
        fields: [
          { id: "fresh", type: "text", label: "Fresh", required: false },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(state.updated).toBeNull();
  });

  it("renames a form without asking for a revision or touching a custom slug", async () => {
    state.existing.slug = "our-custom-link";

    await updateForm.run({ id: "form-1", title: "Renamed" });

    expect(state.updated).toMatchObject({
      title: "Renamed",
      slug: "our-custom-link",
    });
  });

  it("keeps the slug of a published form when it's renamed", async () => {
    state.existing.status = "published";

    await updateForm.run({ id: "form-1", title: "Renamed" });

    expect(state.updated).toMatchObject({
      title: "Renamed",
      slug: "feedback-form-1",
    });
  });

  it("moves a draft's generated slug along with its title", async () => {
    await updateForm.run({ id: "form-1", title: "Renamed" });

    expect(state.updated).toMatchObject({
      title: "Renamed",
      slug: "renamed-form-1",
    });
  });
});
