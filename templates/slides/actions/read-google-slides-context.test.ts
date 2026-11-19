import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../app/i18n/en-US";
const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  token: vi.fn(),
  fetch: vi.fn(),
  import: vi.fn(),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.fetch,
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: mocks.owner,
  }),
);
vi.mock("../server/lib/google-docs-access.js", () => ({
  getAvailableGoogleDocsAccessToken: mocks.token,
}));
vi.mock("../server/lib/google-slides-reference-messages.js", () => ({
  googleSlidesReferenceMessages: async () => en.home.context.googleSlides,
}));
vi.mock("./import-google-slides-reference.js", () => ({
  default: { run: mocks.import },
}));
import action from "./read-google-slides-context";
const id = "example-presentation-id";
const url = `https://docs.google.com/presentation/d/${id}/edit`;
const text = (content: string) => ({
  text: { textElements: [{ textRun: { content } }] },
});
const presentation = () => ({
  presentationId: id,
  title: "Sample reference",
  slides: [
    {
      objectId: "slide-one",
      pageElements: [
        { shape: text("Slide headline") },
        { table: { tableRows: [{ tableCells: [text("Table fact")] }] } },
        { elementGroup: { children: [{ shape: text("Grouped detail") }] } },
      ],
      slideProperties: {
        notesPage: {
          notesProperties: { speakerNotesObjectId: "notes-one" },
          pageElements: [
            { objectId: "notes-one", shape: text("Presenter notes") },
            {
              objectId: "placeholder",
              shape: text("Ignored template boilerplate"),
            },
          ],
        },
      },
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.mockReturnValue("viewer@example.test");
  mocks.token.mockResolvedValue({
    accessToken: "FAKE_TEST_ACCESS_TOKEN",
    accountEmail: "viewer@example.test",
  });
  mocks.fetch.mockImplementation(async () => Response.json(presentation()));
});
describe("read-only Google Slides context", () => {
  it("reads scoped text, tables, groups and only speaker notes without invoking import or returning credentials", async () => {
    const result = await action.run({ presentationUrl: url });
    expect(mocks.token).toHaveBeenCalledWith("viewer@example.test");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [endpoint, options, safety] = mocks.fetch.mock.calls[0] ?? [];
    expect(new URL(endpoint).origin).toBe("https://slides.googleapis.com");
    expect(new URL(endpoint).pathname).toBe(`/v1/presentations/${id}`);
    expect(options.headers.Authorization).toBe("Bearer FAKE_TEST_ACCESS_TOKEN");
    expect(safety).toEqual({ httpsOnly: true, maxRedirects: 0 });
    expect(result).toMatchObject({
      id,
      title: "Sample reference",
      url,
      truncated: false,
      slideCount: 1,
    });
    for (const content of [
      "Slide headline",
      "Table fact",
      "Grouped detail",
      "Presenter notes",
    ])
      expect(result.context).toContain(content);
    expect(result.context).not.toContain("Ignored template boilerplate");
    expect(JSON.stringify(result)).not.toContain("FAKE_TEST_ACCESS_TOKEN");
    expect(mocks.import).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("deckId");
    expect(result).not.toHaveProperty("imported");
  });
  it.each([
    "https://example.com/presentation/d/fake/edit",
    "http://docs.google.com/presentation/d/fake/edit",
    "https://docs.google.com.evil.test/presentation/d/fake/edit",
  ])(
    "rejects an unrelated or unsafe URL before resolving credentials: %s",
    async (presentationUrl) => {
      await expect(action.run({ presentationUrl })).rejects.toMatchObject({
        errorCode: "google_slides_reference_invalid",
      });
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
  it("requires current authentication and a scoped connection", async () => {
    mocks.owner.mockReturnValueOnce(undefined);
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      statusCode: 401,
    });
    mocks.token.mockResolvedValueOnce(null);
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      errorCode: "google_drive_not_connected",
      statusCode: 412,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])(
    "rejects withdrawn provider access instead of returning cached context: %i",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(new Response("Denied", { status }));
      await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
        errorCode: "google_slides_reference_unavailable",
        statusCode: 403,
      });
      expect(mocks.import).not.toHaveBeenCalled();
    },
  );
  it("marks a bounded excerpt explicitly and rejects oversized provider responses", async () => {
    const data = presentation();
    const first = data.slides.at(0);
    if (!first) throw new Error("Missing test slide");
    first.pageElements = [{ shape: text("x".repeat(30_000)) }];
    mocks.fetch.mockResolvedValueOnce(Response.json(data));
    const result = await action.run({ presentationUrl: url });
    expect(result.truncated).toBe(true);
    expect(result.context.length).toBeLessThanOrEqual(19_000);
    expect(result.context).toContain(en.home.context.googleSlides.truncated);
    mocks.fetch.mockResolvedValueOnce(new Response("x".repeat(1_048_577)));
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      errorCode: "google_slides_reference_too_large",
      statusCode: 413,
    });
  });
  it("fails visibly for unreadable provider data", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ presentationId: "other", title: "Wrong file" }),
    );
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      errorCode: "google_slides_reference_unreadable",
    });
  });
  it("distinguishes an unreadable scoped connection from a disconnected account", async () => {
    mocks.token.mockRejectedValueOnce(new Error("Vault unavailable"));
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      errorCode: "google_drive_connection_unreadable",
      statusCode: 502,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("reports an interrupted response as a typed read failure", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Interrupted"));
          },
        }),
      ),
    );
    await expect(action.run({ presentationUrl: url })).rejects.toMatchObject({
      errorCode: "google_slides_reference_network_failed",
      statusCode: 502,
    });
  });
  it("marks nested group excerpts as truncated", async () => {
    let element: Record<string, unknown> = { shape: text("Deep content") };
    for (let depth = 0; depth < 22; depth++)
      element = { elementGroup: { children: [element] } };
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        ...presentation(),
        slides: [{ objectId: "nested", pageElements: [element] }],
      }),
    );
    const result = await action.run({ presentationUrl: url });
    expect(result.truncated).toBe(true);
    expect(result.context).toContain(en.home.context.googleSlides.truncated);
  });
  it("satisfies the public action input/output and failure contracts", async () => {
    await checkActionProperties(action, {
      context: {
        caller: "frontend",
        userEmail: "viewer@example.test",
        orgId: "org-one",
      },
      runs: 20,
      seed: 7,
    });
  });
});
