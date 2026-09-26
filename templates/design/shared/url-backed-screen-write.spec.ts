import { describe, expect, it } from "vitest";

import { applyVisualEdit, moveNodeBetweenDocuments } from "./code-layer.js";
import { isStandaloneHttpUrl } from "./html-content.js";
import {
  DesignHtmlIntegrityError,
  assertDesignHtmlEditIntegrity,
} from "./html-integrity.js";

const SCREEN_URL = "http://localhost:8210/";

const CORRUPTED_CONTENT =
  `${SCREEN_URL}<div data-agent-native-node-id="an-17l5gng" ` +
  `data-agent-native-layer-name="Group" style="position:absolute; left:126px; ` +
  `top:40px; width:200px; height:120px;">\n  <p>Group</p>\n</div>`;

const SOURCE_SCREEN = `<!doctype html><html><head></head><body><div data-agent-native-node-id="an-17l5gng" data-agent-native-layer-name="Group" style="position:absolute; left:126px; top:40px;"><p>Group</p></div></body></html>`;

describe("isStandaloneHttpUrl", () => {
  it("accepts a clean route URL", () => {
    expect(isStandaloneHttpUrl(SCREEN_URL)).toBe(true);
    expect(isStandaloneHttpUrl("  https://example.com/app?a=1#b  ")).toBe(true);
  });

  it("rejects the corrupted route-plus-markup content", () => {
    expect(() => new URL(CORRUPTED_CONTENT)).not.toThrow();
    expect(isStandaloneHttpUrl(CORRUPTED_CONTENT)).toBe(false);
  });

  it("rejects documents and fragments", () => {
    expect(isStandaloneHttpUrl("<html><body>real</body></html>")).toBe(false);
    expect(isStandaloneHttpUrl("")).toBe(false);
  });
});

describe("moveNodeBetweenDocuments on a URL-backed screen", () => {
  it("refuses to append a layer onto a route URL destination", () => {
    const result = moveNodeBetweenDocuments(SOURCE_SCREEN, SCREEN_URL, {
      nodeId: "an-17l5gng",
      placement: "inside",
    });

    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/live route URL/i);
    expect(result.destHtml).toBe(SCREEN_URL);
    expect(result.sourceHtml).toBe(SOURCE_SCREEN);
  });

  it("refuses to move a layer OUT of a route URL source", () => {
    const result = moveNodeBetweenDocuments(SCREEN_URL, SOURCE_SCREEN, {
      nodeId: "an-17l5gng",
    });

    expect(result.status).toBe("unsupported");
    expect(result.destHtml).toBe(SOURCE_SCREEN);
  });

  it("still moves layers between two real documents", () => {
    const dest = `<!doctype html><html><head></head><body><main data-agent-native-node-id="an-dest"></main></body></html>`;
    const result = moveNodeBetweenDocuments(SOURCE_SCREEN, dest, {
      nodeId: "an-17l5gng",
      anchorNodeId: "an-dest",
      placement: "inside",
    });

    expect(result.status).toBe("applied");
    expect(result.destHtml).toContain("an-17l5gng");
    expect(result.sourceHtml).not.toContain("an-17l5gng");
  });
});

describe("applyVisualEdit on a URL-backed screen", () => {
  it("refuses an edit with a typed reason and no mutation", () => {
    const patch = applyVisualEdit(SCREEN_URL, {
      kind: "style",
      target: { nodeId: "an-17l5gng" },
      property: "color",
      value: "red",
    });

    expect(patch.result.status).toBe("unsupported");
    expect(patch.result.changed).toBe(false);
    expect(patch.result.message).toMatch(/live route URL/i);
    expect(patch.content).toBe(SCREEN_URL);
  });

  it("still edits a real document", () => {
    const patch = applyVisualEdit(SOURCE_SCREEN, {
      kind: "style",
      target: { nodeId: "an-17l5gng" },
      property: "color",
      value: "red",
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("color: red");
  });
});

describe("assertDesignHtmlEditIntegrity on a URL-backed screen", () => {
  it("refuses the exact corrupting write", () => {
    let thrown: unknown;
    try {
      assertDesignHtmlEditIntegrity({
        previousContent: SCREEN_URL,
        nextContent: CORRUPTED_CONTENT,
        fileType: "html",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DesignHtmlIntegrityError);
    expect((thrown as DesignHtmlIntegrityError).issue).toBe(
      "url-backed-screen-replaced",
    );
    expect((thrown as Error).message).toMatch(/live route URL/i);
  });

  it("is the only rule that can see this corruption", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: "<p>fragment</p>",
        nextContent: CORRUPTED_CONTENT,
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("refuses a full document replacing a route URL", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: SCREEN_URL,
        nextContent: SOURCE_SCREEN,
        fileType: "html",
      }),
    ).toThrow(DesignHtmlIntegrityError);
  });

  it("refuses regardless of the fileType the caller threaded through", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: SCREEN_URL,
        nextContent: CORRUPTED_CONTENT,
        fileType: "css",
      }),
    ).toThrow(DesignHtmlIntegrityError);
  });

  it("allows re-pointing a URL-backed screen at another route", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: SCREEN_URL,
        nextContent: "http://localhost:8220/dashboard",
        fileType: "html",
      }),
    ).not.toThrow();
  });
});
