// @vitest-environment happy-dom

import { createContentEditorStructuralSchema } from "@shared/content-editor-structural-schema";
import { LIVE_BODY_FIELD } from "@shared/live-body";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeStateAsUpdate, XmlElement, XmlText } from "yjs";

const calls = vi.hoisted(() => ({
  callAction: vi.fn(async (..._args: unknown[]) => ({ recorded: true })),
}));
const builds = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: calls.callAction,
}));
vi.mock("@tiptap/y-tiptap", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tiptap/y-tiptap")>();
  return {
    ...original,
    yXmlFragmentToProseMirrorRootNode: (
      ...args: Parameters<typeof original.yXmlFragmentToProseMirrorRootNode>
    ) => {
      builds.count += 1;
      if (builds.fail) throw new Error("build failed");
      return original.yXmlFragmentToProseMirrorRootNode(...args);
    },
  };
});

const { measureLiveBodyParity, reportLiveBodyParity } =
  await import("./live-body-parity");

function livePage(markdown: string) {
  const json = nfmToDoc(markdown);
  return {
    ydoc: prosemirrorJSONToYDoc(
      createContentEditorStructuralSchema(),
      json,
      LIVE_BODY_FIELD,
    ),
    saved: docToNfm(json),
  };
}

beforeEach(() => {
  builds.count = 0;
  builds.fail = false;
  calls.callAction.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("measureLiveBodyParity", () => {
  it("reports a match with its cost", () => {
    const { ydoc, saved } = livePage("Alpha paragraph");
    const report = measureLiveBodyParity(ydoc, saved);
    expect(report).toEqual({
      outcome: "match",
      ms: expect.any(Number),
      bytes: encodeStateAsUpdate(ydoc).length,
    });
  });

  it("reports where a mismatch starts", () => {
    const { ydoc } = livePage("Alpha paragraph");
    expect(measureLiveBodyParity(ydoc, "Alpha")).toMatchObject({
      outcome: "mismatch",
      mismatch: { block: 0, at: 5 },
    });
  });

  it("builds from a copy, leaving the editor's live copy intact", () => {
    const { ydoc, saved } = livePage("Alpha paragraph");
    const unknown = new XmlElement("notAContentNode");
    const text = new XmlText();
    text.insert(0, "must survive");
    unknown.insert(0, [text]);
    ydoc.getXmlFragment(LIVE_BODY_FIELD).insert(1, [unknown]);
    const before = encodeStateAsUpdate(ydoc);

    expect(measureLiveBodyParity(ydoc, saved).outcome).toBe("lossy");
    expect(encodeStateAsUpdate(ydoc)).toEqual(before);
    expect(ydoc.getXmlFragment(LIVE_BODY_FIELD).toString()).toContain(
      "must survive",
    );
  });

  it("counts a live copy too large to build without building it", () => {
    const body = "x".repeat(300 * 1024);
    const { ydoc } = livePage(body);
    expect(measureLiveBodyParity(ydoc, body)).toMatchObject({
      outcome: "too-large",
      bytes: expect.any(Number),
    });
    expect(builds.count).toBe(0);
  });

  it("reports a failed build as an error instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    builds.fail = true;
    const { ydoc, saved } = livePage("Alpha paragraph");
    expect(measureLiveBodyParity(ydoc, saved).outcome).toBe("error");
    expect(warn).toHaveBeenCalled();
  });
});

describe("reportLiveBodyParity", () => {
  it("sends the report to the counting action", () => {
    reportLiveBodyParity("page", { outcome: "match", ms: 3, bytes: 120 });
    expect(calls.callAction).toHaveBeenCalledWith("record-live-body-parity", {
      id: "page",
      outcome: "match",
      ms: 3,
      bytes: 120,
    });
  });

  it("logs a failed report instead of rejecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    calls.callAction.mockRejectedValueOnce(new Error("offline"));
    reportLiveBodyParity("page", { outcome: "match", ms: 3, bytes: 120 });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[content] live body parity report failed",
        expect.objectContaining({ documentId: "page" }),
      ),
    );
  });
});
