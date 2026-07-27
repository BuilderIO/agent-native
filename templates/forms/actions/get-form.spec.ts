import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = {
  submitText: "Send",
  successMessage: "Thanks",
  showProgressBar: true,
  integrations: [
    {
      id: "slack_1",
      type: "slack",
      name: "Team Slack",
      enabled: true,
      url: "https://hooks.example.test/services/example",
    },
  ],
  allowedOrigins: ["https://owner-console.example.test"],
};

const form = {
  id: "form_1",
  title: "Hackathon Submission",
  description: "",
  slug: "hackathon-submission",
  fields: JSON.stringify([
    { id: "name", type: "text", label: "Name", required: true },
  ]),
  settings: JSON.stringify(settings),
  status: "published",
  visibility: "private",
  ownerEmail: "owner@example.com",
  orgId: "org_1",
  deletedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const dbMock = vi.hoisted(() => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 2 }]),
      })),
    })),
  }),
}));

const sharingMock = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("@agent-native/core/sharing", () => sharingMock);

const { default: getForm } = await import("./get-form.js");

describe("get-form action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips owner-private settings for viewer access", async () => {
    sharingMock.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: form,
    });

    const result = await getForm.run({ id: "form_1" });

    expect(result.role).toBe("viewer");
    expect(result.settings).toEqual({
      submitText: "Send",
      successMessage: "Thanks",
      showProgressBar: true,
    });
    expect(result.settings).not.toHaveProperty("integrations");
    expect(result.settings).not.toHaveProperty("allowedOrigins");
  });

  it("keeps full settings for editors", async () => {
    sharingMock.resolveAccess.mockResolvedValue({
      role: "editor",
      resource: form,
    });

    const result = await getForm.run({ id: "form_1" });

    expect(result.settings).toEqual(settings);
  });
});
