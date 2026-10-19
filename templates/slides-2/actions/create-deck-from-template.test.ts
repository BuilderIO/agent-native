import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  insertValues: vi.fn(),
  notifyClients: vi.fn(),
  userEmail: vi.fn<() => string | undefined>(() => "owner@example.test"),
  orgId: vi.fn<() => string | undefined>(() => "org-one"),
  track: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: mocks.assertAccess,
  ForbiddenError: class extends Error {},
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.userEmail,
  getRequestOrgId: mocks.orgId,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ insert: () => ({ values: mocks.insertValues }) }),
  schema: { decks: {} },
}));
vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mocks.notifyClients,
}));
vi.mock("./_app-url.js", () => ({ getDeckUrl: (id: string) => `/deck/${id}` }));

import { getBuiltInDeckTemplate } from "../server/lib/deck-templates.js";
import { legacySlideHtmlToSource } from "../server/lib/legacy-slide-source.js";
import { renderSlideSource } from "../server/lib/slide-source.js";
import action from "./create-deck-from-template.js";

const request = { templateId: "starter-pitch", newId: "deck-copy" };
const conflict = { statusCode: 409, errorCode: "deck_template_copy_conflict" };

function savedRow() {
  return structuredClone(mocks.insertValues.mock.calls[0][0]);
}

function persistedRow(id: string) {
  const row = mocks.insertValues.mock.calls
    .map(([value]) => value)
    .find((value) => value.id === id);
  return row ? structuredClone(row) : null;
}

describe("create-deck-from-template through add-deck persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.userEmail.mockReturnValue("owner@example.test");
    mocks.orgId.mockReturnValue("org-one");
    mocks.resolveAccess.mockImplementation((_resource, id) => {
      const row = persistedRow(id);
      return Promise.resolve(row ? { resource: row } : null);
    });
  });

  it("persists every editable slide under the authenticated owner/org and notifies once", async () => {
    const result = await action.run(request);
    const row = savedRow();
    const deck = JSON.parse(row.data);
    const template = getBuiltInDeckTemplate(request.templateId)!;
    expect(result).toEqual({
      id: "deck-copy",
      title: template.title,
      templateId: "starter-pitch",
      slideCount: template.slides.length,
      designSystemId: null,
      url: "/deck/deck-copy",
      reused: false,
      _receipt: {
        changed: true,
        verified: true,
        summary: "Created a template copy and verified that it was saved.",
        subject: "deck-copy",
        checks: [
          {
            id: "template-copy-persisted",
            ok: true,
            detail: "The saved deck is accessible in the caller's scope.",
          },
        ],
      },
    });
    expect(row).toMatchObject({
      id: result.id,
      ownerEmail: "owner@example.test",
      orgId: "org-one",
      designSystemId: null,
    });
    expect(deck).toMatchObject({
      id: result.id,
      appId: "slides-2",
      title: result.title,
      aspectRatio: "16:9",
      designSystemId: null,
      templateSource: {
        templateId: request.templateId,
        version: 1,
        createdTitle: template.title,
      },
    });
    expect(deck.slides).toHaveLength(template.slides.length);
    for (const [index, slide] of deck.slides.entries()) {
      const sourceSlide = template.slides[index]!;
      expect(slide.sourceTsx).toBe(
        legacySlideHtmlToSource(sourceSlide.content),
      );
      expect(slide.notes).toBe(sourceSlide.notes);
    }
    expect(deck.slides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTsx: expect.stringContaining("export default function Slide"),
          revision: 1,
          sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(
      deck.slides.every(
        (slide: { content: string; sourceTsx: string }) =>
          slide.content === renderSlideSource(slide.sourceTsx, new Map()) &&
          !/<\/?style\b/i.test(slide.content),
      ),
    ).toBe(true);
    expect(deck.designTokens).toMatchObject({
      background: "#142B36",
      text: "#F5F7EE",
      accent: "#D8ED74",
    });
    expect(
      new Set(deck.slides.map((slide: { id: string }) => slide.id)).size,
    ).toBe(template.slides.length);
    expect(
      deck.slides.every(
        (slide: { id: string }) =>
          !template.slides.some((original) => original.id === slide.id),
      ),
    ).toBe(true);
    expect(deck.createdAt).toBe(row.createdAt);
    expect(deck.updatedAt).toBe(row.updatedAt);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.notifyClients).toHaveBeenCalledExactlyOnceWith(result.id);
  });

  it("creates the Swiss pitch only after every generated source page validates", async () => {
    const templateId = "starter-swiss-pitch";
    const template = getBuiltInDeckTemplate(templateId)!;
    const result = await action.run({
      templateId,
      newId: "swiss-pitch-copy",
    });
    const deck = JSON.parse(savedRow().data);

    expect(template.title).toBe("Swiss pitch");
    expect(result).toMatchObject({
      id: "swiss-pitch-copy",
      templateId,
      slideCount: template.slides.length,
      reused: false,
    });
    expect(deck.slides).toHaveLength(template.slides.length);
    for (const [index, slide] of deck.slides.entries()) {
      expect(slide.sourceTsx).toContain("export default function Slide");
      expect(slide.revision).toBe(1);
      expect(slide.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(slide.content).toBe(renderSlideSource(slide.sourceTsx, new Map()));
      expect(slide.content).not.toMatch(/<\/?style\b/i);
      expect(slide.id).not.toBe(template.slides[index]?.id);
    }
  });

  it("copies built-in list-style templates into editable source-backed decks", async () => {
    const templateId = "starter-manifesto";
    const template = getBuiltInDeckTemplate(templateId)!;
    const result = await action.run({
      templateId,
      newId: "manifesto-template-copy",
    });
    const deck = JSON.parse(savedRow().data);

    expect(result).toMatchObject({
      id: "manifesto-template-copy",
      templateId,
      slideCount: template.slides.length,
      reused: false,
    });
    expect(deck.slides).toHaveLength(template.slides.length);
    expect(
      deck.slides.some((slide: { sourceTsx: string }) =>
        slide.sourceTsx.includes('"listStyleType": "none"'),
      ),
    ).toBe(true);
    expect(
      deck.slides.every(
        (slide: { content: string; sourceTsx: string }) =>
          slide.content === renderSlideSource(slide.sourceTsx, new Map()),
      ),
    ).toBe(true);
  });

  it("records the template deck exactly once", async () => {
    await action.run(request);

    const created = mocks.track.mock.calls.filter(
      ([name]) => name === "deck_created",
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.[1]).toMatchObject({
      output_id: "deck-copy",
      creation_method: "template",
      purpose: "direct",
    });
  });

  it("creates independent deck and slide IDs when no retry key is given", async () => {
    const a = await action.run({ templateId: "starter-workshop" });
    const first = JSON.parse(savedRow().data);
    const b = await action.run({ templateId: "starter-workshop" });
    const second = JSON.parse(mocks.insertValues.mock.calls[1][0].data);
    expect(a.id).not.toBe(b.id);
    expect(
      second.slides.every(
        (slide: { id: string }) =>
          !first.slides.some(
            (original: { id: string }) => original.id === slide.id,
          ),
      ),
    ).toBe(true);
    first.slides[0].content = "User edit";
    expect(
      getBuiltInDeckTemplate("starter-workshop")?.slides[0].content,
    ).not.toBe(second.slides[0].content);
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
    expect(mocks.resolveAccess).toHaveBeenNthCalledWith(1, "deck", a.id);
    expect(mocks.resolveAccess).toHaveBeenNthCalledWith(2, "deck", b.id);
  });

  it("allows authenticated personal-scope creation without inventing an org", async () => {
    mocks.orgId.mockReturnValue(undefined);
    await action.run(request);
    expect(savedRow().orgId).toBeNull();
  });

  it("rejects signed-out callers before reading or writing decks", async () => {
    mocks.userEmail.mockReturnValue(undefined);
    await expect(action.run(request)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "unauthorized",
    });
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rejects unknown templates without looking up supplied deck IDs", async () => {
    await expect(
      action.run({ ...request, templateId: "unknown" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_template_not_found",
    });
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("replays only the original operation without overwriting edited content, title, or brand", async () => {
    await action.run(request);
    const row = savedRow();
    const data = JSON.parse(row.data);
    data.slides[0].content = "<div>Later edit</div>";
    row.data = JSON.stringify(data);
    row.title = "Edited title";
    row.designSystemId = "later-system";
    mocks.resolveAccess.mockResolvedValue({ resource: row });
    const before = structuredClone(row);
    expect(await action.run(request)).toMatchObject({
      reused: true,
      title: "Edited title",
      designSystemId: "later-system",
      slideCount: getBuiltInDeckTemplate(request.templateId)!.slides.length,
      _receipt: {
        changed: false,
        verified: true,
        summary: "Reused the existing template copy; no changes were made.",
        subject: "deck-copy",
      },
    });
    expect(row).toEqual(before);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.notifyClients).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenLastCalledWith("deck", "deck-copy");
  });

  it.each([
    ["another user", { ownerEmail: "other@example.test" }],
    ["another organization", { orgId: "org-two" }],
    ["legacy personal scope", { orgId: null }],
  ])(
    "does not replay a deck belonging to %s even when otherwise readable",
    async (_label, override) => {
      await action.run(request);
      mocks.resolveAccess.mockResolvedValue({
        resource: { ...savedRow(), ...override },
      });
      await expect(action.run(request)).rejects.toMatchObject(conflict);
      expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["template", { ...request, templateId: "starter-update" }],
    ["original title", { ...request, title: "A different title" }],
  ])("rejects retry keys reused for another %s", async (_label, next) => {
    await action.run(request);
    mocks.resolveAccess.mockResolvedValue({ resource: savedRow() });
    await expect(action.run(next)).rejects.toMatchObject(conflict);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid json", JSON.stringify({ id: "deck-copy", slides: [] })])(
    "does not treat unproven or corrupted data as a successful copy",
    async (data) => {
      mocks.resolveAccess.mockResolvedValue({
        resource: { ownerEmail: "owner@example.test", orgId: "org-one", data },
      });
      await expect(action.run(request)).rejects.toMatchObject(conflict);
      expect(mocks.insertValues).not.toHaveBeenCalled();
    },
  );

  it("does not leak inaccessible deck identity on ID collision", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.insertValues.mockRejectedValue(
      Object.assign(new Error("private database detail"), {
        cause: { code: "23505" },
      }),
    );
    await expect(action.run(request)).rejects.toMatchObject({
      ...conflict,
      message:
        "This copy request cannot be reused. Start a new copy with a new ID.",
    });
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("replays a proven concurrent insert without a second write or notification", async () => {
    await action.run(request);
    const row = savedRow();
    vi.clearAllMocks();
    mocks.resolveAccess
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ resource: row });
    mocks.insertValues.mockRejectedValue({ cause: { code: "23505" } });
    expect(await action.run(request)).toMatchObject({
      reused: true,
      id: row.id,
    });
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.notifyClients).not.toHaveBeenCalled();
  });

  it("propagates genuine persistence or notification failures", async () => {
    const failure = new Error("database unavailable");
    mocks.insertValues.mockRejectedValueOnce(failure);
    await expect(action.run(request)).rejects.toBe(failure);
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(1);
    mocks.notifyClients.mockRejectedValueOnce(failure);
    await expect(action.run({ templateId: "starter-pitch" })).rejects.toBe(
      failure,
    );
  });

  it("fails with the copy ID when the saved row cannot be read back", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    await expect(action.run(request)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "deck_template_copy_readback_failed",
      details: { deckId: "deck-copy" },
    });
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
  });

  it("marks only requests with a stable copy ID as retry-safe", () => {
    expect(action.retrySafe?.(request)).toBe(true);
    expect(action.retrySafe?.({ templateId: "starter-pitch" })).toBe(false);
  });

  it.each([
    { newId: "../deck" },
    { newId: "x".repeat(129) },
    { title: " " },
    { title: "x".repeat(201) },
  ])("validates unsafe IDs and titles %j", (args) => {
    expect(
      action.schema.safeParse({ templateId: "starter-pitch", ...args }).success,
    ).toBe(false);
  });

  it("builds a pure link without touching persistence", () => {
    expect(
      action.link?.({ result: { id: "deck-copy" } } as never),
    ).toMatchObject({ view: "editor" });
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
