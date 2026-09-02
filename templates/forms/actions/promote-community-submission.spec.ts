import { beforeEach, describe, expect, it, vi } from "vitest";

const response = {
  id: "response_123456",
  formId: "form_community",
  data: JSON.stringify({
    name: "Nomad",
    app_url: "nomad.example.com",
    description: "A travel planning workspace.",
    repository_url: "github.com/example/nomad",
    screenshots: [
      {
        url: "https://files.example.test/nomad.png",
        name: "nomad.png",
        type: "image/png",
        size: 120,
      },
    ],
  }),
  submittedAt: "2026-09-02T12:00:00.000Z",
  promotionStatus: null,
  builderContentId: null,
  communitySlug: null,
  promotionError: null,
  promotedAt: null,
  promotedBy: null,
};

const form = {
  id: "form_community",
  slug: "community-app-submission",
  fields: JSON.stringify([
    { id: "name", label: "App name", type: "text", required: true },
    { id: "app_url", label: "App URL", type: "text", required: true },
    {
      id: "description",
      label: "Description",
      type: "textarea",
      required: true,
    },
    {
      id: "repository_url",
      label: "GitHub repository URL",
      type: "text",
      required: false,
    },
    {
      id: "screenshots",
      label: "Screenshots",
      type: "file",
      required: false,
    },
  ]),
};

const dbMock = vi.hoisted(() => {
  let selectResults: unknown[][] = [];
  let claimResult: unknown[] = [{ id: "response_123456" }];
  const updates: unknown[] = [];

  function selectQuery() {
    const result = selectResults.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => result),
    };
    return builder;
  }

  return {
    updates,
    setResults(next: unknown[][]) {
      selectResults = [...next];
      claimResult = [{ id: "response_123456" }];
      updates.length = 0;
    },
    setClaimResult(next: unknown[]) {
      claimResult = next;
    },
    getDb: () => ({
      select: vi.fn(() => selectQuery()),
      update: vi.fn(() => ({
        set: vi.fn((value) => {
          updates.push(value);
          const whereResult = {
            returning: vi.fn(async () => claimResult),
          };
          return { where: vi.fn(() => whereResult) };
        }),
      })),
    }),
  };
});

const credentialMock = vi.hoisted(() => vi.fn());

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "reviewer@example.com",
  readDeployCredentialEnv: credentialMock,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ resource: form })),
}));

const { default: promoteCommunitySubmission } =
  await import("./promote-community-submission.js");

describe("promote-community-submission action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.setResults([[response], [form]]);
    credentialMock.mockReturnValue("private-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "builder-entry-1" }), {
            status: 200,
          }),
      ),
    );
  });

  it("normalizes friendly URLs and publishes uploaded screenshot references", async () => {
    const result = await promoteCommunitySubmission.run({
      responseId: response.id,
    });

    expect(result).toMatchObject({
      status: "published",
      slug: "nomad-respon",
      builderContentId: "builder-entry-1",
    });
    expect(dbMock.updates[0]).toMatchObject({ promotionStatus: "publishing" });
    expect(dbMock.updates[1]).toMatchObject({
      promotionStatus: "published",
      builderContentId: "builder-entry-1",
      communitySlug: "nomad-respon",
    });
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(fetchCall?.[1]?.body));
    expect(body.published).toBe("published");
    expect(body.data.demoUrl).toBe("https://nomad.example.com/");
    expect(body.data.screenshots).toEqual([
      "https://files.example.test/nomad.png",
    ]);
  });

  it("records an ambiguous Builder result as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );

    await expect(
      promoteCommunitySubmission.run({ responseId: response.id }),
    ).rejects.toMatchObject({ errorCode: "promotion_unknown" });
    expect(dbMock.updates[1]).toMatchObject({
      promotionStatus: "unknown",
    });
  });

  it("does not publish when another reviewer claims the response first", async () => {
    dbMock.setClaimResult([]);

    await expect(
      promoteCommunitySubmission.run({ responseId: response.id }),
    ).rejects.toMatchObject({ errorCode: "promotion_unknown" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
