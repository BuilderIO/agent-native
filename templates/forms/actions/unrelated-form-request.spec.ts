import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormField } from "../shared/types.js";

interface FormRow {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  fields: string;
  settings: string;
  status: string;
  visibility: string;
  ownerEmail: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

type RowPredicate = (row: FormRow) => boolean;

const rows = vi.hoisted(() => [] as unknown[]);

vi.mock("@agent-native/core", async () => {
  const actual =
    await vi.importActual<typeof import("@agent-native/core")>(
      "@agent-native/core",
    );
  return {
    ...actual,
    defineAction: (options: unknown) => options,
    embedApp: () => ({}),
  };
});

vi.mock("@agent-native/core/action", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/action")
  >("@agent-native/core/action");
  return { ...actual, defineAction: (options: unknown) => options };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (input: { to?: string }) =>
    `https://forms.agent-native.test${input.to ?? ""}`,
  getAppProductionUrl: () => "https://forms.agent-native.test",
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({ assertAccess: async () => {} }));
vi.mock("@agent-native/core/tracking", () => ({ track: () => {} }));

vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: () => {},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq:
    (column: string, value: unknown): RowPredicate =>
    (row) =>
      (row as unknown as Record<string, unknown>)[column] === value,
  and:
    (...predicates: RowPredicate[]): RowPredicate =>
    (row) =>
      predicates.every((predicate) => predicate(row)),
}));

vi.mock("../server/db/index.js", () => {
  const table = rows as FormRow[];
  return {
    schema: {
      forms: {
        id: "id",
        fields: "fields",
        updatedAt: "updatedAt",
      },
    },
    getDb: () => ({
      insert: () => ({
        values: async (row: FormRow) => {
          table.push(row);
        },
      }),
      select: () => ({
        from: () => ({
          where: (predicate: RowPredicate) => ({
            limit: async () => table.filter(predicate),
          }),
        }),
      }),
      update: () => ({
        set: (updates: Partial<FormRow>) => ({
          where: (predicate: RowPredicate) => ({
            returning: async () => {
              const match = table.find(predicate);
              if (!match) return [];
              Object.assign(match, updates);
              return [{ id: match.id }];
            },
          }),
        }),
      }),
    }),
  };
});

const { default: createForm } = await import("./create-form.js");
const { default: updateForm } = await import("./update-form.js");

const CUSTOMER_FEEDBACK_FIELDS: FormField[] = [
  { id: "full_name", type: "text", label: "Full Name", required: false },
  { id: "email", type: "email", label: "Email", required: true },
  { id: "rating", type: "scale", label: "Rating", required: false },
  {
    id: "feedback_comments",
    type: "textarea",
    label: "Feedback Comments",
    required: false,
  },
];

const EVENT_REGISTRATION_FIELDS: FormField[] = [
  { id: "full_name", type: "text", label: "Full Name", required: true },
  { id: "email", type: "email", label: "Email", required: true },
  {
    id: "hotel_pass",
    type: "radio",
    label: "Do you need a hotel pass?",
    options: ["Yes", "No"],
    required: true,
  },
  {
    id: "check_in_date",
    type: "date",
    label: "Check-in Date",
    required: false,
    conditional: { fieldId: "hotel_pass", operator: "equals", value: "Yes" },
  },
  {
    id: "room_type",
    type: "select",
    label: "Room Type",
    options: ["Single", "Double"],
    required: false,
    conditional: { fieldId: "hotel_pass", operator: "equals", value: "Yes" },
  },
];

async function firstPrompt() {
  return createForm.run(
    { title: "Customer Feedback", fields: CUSTOMER_FEEDBACK_FIELDS },
    {},
  );
}

describe("two unrelated form requests in one session", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("refuses to consume the open draft when the second request is a different form", async () => {
    const feedback = await firstPrompt();

    await expect(
      updateForm.run(
        {
          id: feedback.id,
          title: "Event Registration",
          fields: EVENT_REGISTRATION_FIELDS,
        },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: "unconfirmed_field_loss" });

    expect(rows).toHaveLength(1);
    const stored = rows[0] as FormRow;
    expect(stored.title).toBe("Customer Feedback");
    expect(
      (JSON.parse(stored.fields) as FormField[]).map((field) => field.id),
    ).toEqual(["full_name", "email", "rating", "feedback_comments"]);
  });

  it("ends the session with two separate forms once the second request is routed to create-form", async () => {
    const feedback = await firstPrompt();
    const registration = await createForm.run(
      { title: "Event Registration", fields: EVENT_REGISTRATION_FIELDS },
      {},
    );

    expect(registration.id).not.toBe(feedback.id);
    expect(rows).toHaveLength(2);
    expect((rows as FormRow[]).map((row) => row.title)).toEqual([
      "Customer Feedback",
      "Event Registration",
    ]);
    expect(
      (rows as FormRow[]).map(
        (row) => (JSON.parse(row.fields) as FormField[]).length,
      ),
    ).toEqual([4, 5]);
  });

  it("still rewrites the form in place when the user explicitly asked for it", async () => {
    const feedback = await firstPrompt();

    const result = await updateForm.run(
      {
        id: feedback.id,
        title: "Event Registration",
        fields: EVENT_REGISTRATION_FIELDS,
        confirmReplaceFields: true,
      },
      {},
    );

    expect(result.title).toBe("Event Registration");
    expect(rows).toHaveLength(1);
  });

  it("leaves ordinary edits to the open form alone", async () => {
    const feedback = await firstPrompt();

    const result = await updateForm.run(
      {
        id: feedback.id,
        fields: [
          ...CUSTOMER_FEEDBACK_FIELDS,
          { id: "phone", type: "text", label: "Phone", required: false },
        ],
      },
      {},
    );

    expect(result.fields).toHaveLength(5);
  });
});
