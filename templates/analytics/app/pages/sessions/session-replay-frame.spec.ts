// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  blobToBase64,
  extractVisibleReplayUserMessages,
  isReplayFrameRequest,
  replayFrameFailureReason,
  replayFramePath,
} from "./session-replay-frame";
import { ReplayScreenshotAssetError } from "./session-replay-screenshot";

function replayRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockReplayGeometry(
  document: Document,
  hitTestCalls: { count: number } = { count: 0 },
): () => void {
  const view = document.defaultView!;
  const width = Object.getOwnPropertyDescriptor(view, "innerWidth");
  const height = Object.getOwnPropertyDescriptor(view, "innerHeight");
  const elementFromPoint = Object.getOwnPropertyDescriptor(
    document,
    "elementFromPoint",
  );
  let activeTextNode: Node | null = null;
  Object.defineProperty(view, "innerWidth", {
    configurable: true,
    value: 100,
  });
  Object.defineProperty(view, "innerHeight", {
    configurable: true,
    value: 100,
  });
  const bounds = vi
    .spyOn(view.HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-occlusion-box")) {
        return replayRect(
          Number(this.dataset.left ?? 0),
          Number(this.dataset.top ?? 0),
          Number(this.dataset.width ?? 0),
          Number(this.dataset.height ?? 0),
        );
      }
      if (!this.hasAttribute("data-clip-box")) {
        return replayRect(0, 0, 0, 0);
      }
      return replayRect(
        Number(this.dataset.left ?? 0),
        Number(this.dataset.top ?? 0),
        Number(this.dataset.width ?? 0),
        Number(this.dataset.height ?? 0),
      );
    });
  const textBounds = vi
    .spyOn(view.Range.prototype, "getClientRects")
    .mockImplementation(function (this: Range) {
      activeTextNode = this.startContainer;
      const textElement =
        this.startContainer.parentElement?.closest<HTMLElement>(
          "[data-layout]",
        );
      if (!textElement) return [] as unknown as DOMRectList;
      const left =
        Number(textElement.dataset.left ?? 10) +
        this.startOffset * Number(textElement.dataset.step ?? 0);
      const top = Number(textElement.dataset.top ?? 10);
      return [replayRect(left, top, 4, 10)] as unknown as DOMRectList;
    });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: (x: number, y: number) => {
      hitTestCalls.count += 1;
      const target = Array.from(
        document.querySelectorAll<HTMLElement>("[data-occlusion-box]"),
      ).find((overlay) => {
        if (view.getComputedStyle(overlay).pointerEvents === "none") {
          return false;
        }
        const rect = overlay.getBoundingClientRect();
        return (
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        );
      });
      if (target) return target;
      return (
        activeTextNode?.parentElement?.closest<HTMLElement>("[data-layout]") ??
        document.body
      );
    },
  });
  return () => {
    bounds.mockRestore();
    textBounds.mockRestore();
    if (elementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", elementFromPoint);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    if (width) Object.defineProperty(view, "innerWidth", width);
    else Reflect.deleteProperty(view, "innerWidth");
    if (height) Object.defineProperty(view, "innerHeight", height);
    else Reflect.deleteProperty(view, "innerHeight");
  };
}

describe("replayFramePath", () => {
  it("keeps the path and drops a recorded query and hash", () => {
    expect(
      replayFramePath("/onboarding/role?code=abc&email=a@b.co#token=x"),
    ).toBe("/onboarding/role");
    expect(replayFramePath("/home#section")).toBe("/home");
    expect(replayFramePath("/plain")).toBe("/plain");
    expect(replayFramePath("")).toBe("");
  });

  it("names dynamic segments instead of copying them", () => {
    expect(replayFramePath("/invite/alice@example.com/accept?x=1")).toBe(
      "/invite/:email/accept",
    );
    expect(replayFramePath("/reset/9f8e7d6c5b4a39281706f5e4d3c2b1a0")).toBe(
      "/reset/:id",
    );
  });
});

describe("isReplayFrameRequest", () => {
  it("needs a recording path, frame=1, a scoped token, and a bounded seek", () => {
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1",
        "?frame=1&agent_access=tok&capture_through_ms=5",
      ),
    ).toBe(true);
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1/",
        "?agent_access=tok&frame=1&capture_through_ms=5",
      ),
    ).toBe(true);
  });

  it("never opens the unauthenticated frame without a token", () => {
    expect(
      isReplayFrameRequest("/sessions/sr_1", "?frame=1&capture_through_ms=5"),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1",
        "?frame=1&agent_access=&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1",
        "?frame=1&agent_access=tok&capture_through_ms=bad",
      ),
    ).toBe(false);
  });

  it("leaves every other page, and the normal viewer, alone", () => {
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1",
        "?agent_access=tok&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1",
        "?frame=true&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions",
        "?frame=1&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/events",
        "?frame=1&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/performance/",
        "?frame=1&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/dashboards/d1",
        "?frame=1&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
    expect(
      isReplayFrameRequest(
        "/sessions/a/b",
        "?frame=1&agent_access=t&capture_through_ms=5",
      ),
    ).toBe(false);
  });
});

describe("replayFrameFailureReason", () => {
  it("names uncapturable assets without echoing the message", () => {
    expect(replayFrameFailureReason(new ReplayScreenshotAssetError())).toBe(
      "assets_not_capturable",
    );
  });

  it("collapses and bounds other errors", () => {
    expect(replayFrameFailureReason(new Error("offset_out_of_range"))).toBe(
      "offset_out_of_range",
    );
    expect(replayFrameFailureReason(new Error("a\n\n b"))).toBe("a b");
    expect(replayFrameFailureReason(new Error("x".repeat(500)))).toHaveLength(
      200,
    );
    expect(replayFrameFailureReason("boom")).toBe("boom");
    expect(replayFrameFailureReason(new Error(""))).toBe("unknown_error");
    expect(
      replayFrameFailureReason(
        new Error(
          "request failed https://analytics.example.test/path?agent_access=secret",
        ),
      ),
    ).toBe("request failed https://analytics.example.test/path?[redacted]");
  });
});

describe("extractVisibleReplayUserMessages", () => {
  it("reads only visible user-role message text and removes controls", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <p>arbitrary page text</p>
      <article class="agentkit-message" data-role="assistant"><div class="agentkit-user-message-text-content">assistant text</div></article>
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>Visible request <button>button value</button><input type="password" value="password value"><span contenteditable="true">editor value</span><span aria-hidden="true">hidden value</span></div></article>
      <article class="agentkit-message" data-role="user" hidden><div class="agentkit-user-message-text-content">hidden request</div></article>
      <div style="display: none"><article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content">ancestor-hidden request</div></article></div>
      <article class="agentkit-message" data-role="user" style="opacity: 0"><div class="agentkit-user-message-text-content">transparent request</div></article>
    `;

    try {
      expect(
        extractVisibleReplayUserMessages(
          replayDocument,
          548_922,
          75,
          "2026-10-09T00:00:00.000Z",
        ),
      ).toEqual({
        observedOffsetMs: 548_922,
        playheadOffsetMs: 75,
        observedAt: "2026-10-09T00:00:00.000Z",
        messages: [{ role: "user", text: "Visible request" }],
        truncatedMessages: false,
        truncatedCharacters: false,
      });
    } finally {
      restoreGeometry();
    }
  });

  it("keeps only visible text fragments inside the replay viewport and overflow clips", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout data-top="150">offscreen request</div></article>
      <div data-clip-box data-left="20" data-top="0" data-width="15" data-height="100" style="overflow: hidden">
        <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout data-left="10" data-step="5">abcdef</div></article>
      </div>
      <div data-clip-box data-left="80" data-top="0" data-width="10" data-height="100" style="overflow: hidden">
        <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout data-left="10" data-step="5">fully clipped</div></article>
      </div>
    `;
    const clips =
      replayDocument.querySelectorAll<HTMLElement>("[data-clip-box]");
    for (const clip of clips) {
      Object.defineProperties(clip, {
        clientLeft: { configurable: true, value: 0 },
        clientTop: { configurable: true, value: 0 },
        clientWidth: { configurable: true, value: Number(clip.dataset.width) },
        clientHeight: { configurable: true, value: 100 },
      });
    }

    try {
      const result = extractVisibleReplayUserMessages(
        replayDocument,
        100,
        100,
        "now",
      );
      expect(result.messages).toEqual([{ role: "user", text: "cde" }]);
    } finally {
      restoreGeometry();
    }
  });

  it("omits text covered by paint layers that hit testing can miss", () => {
    const overlays = [
      "position: fixed; pointer-events: auto; background-color: rgba(0, 0, 0, 0.8)",
      "position: relative; transform: translateX(0); pointer-events: none; background-image: linear-gradient(#000, #000)",
    ];
    for (const overlayStyle of overlays) {
      const replayDocument = document;
      const restoreGeometry = mockReplayGeometry(replayDocument);
      replayDocument.body.innerHTML = `
        <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>covered request</div></article>
        <div data-occlusion-box data-left="0" data-top="0" data-width="100" data-height="100" style="${overlayStyle}"></div>
      `;

      try {
        const result = extractVisibleReplayUserMessages(
          replayDocument,
          100,
          100,
          "now",
        );
        expect(result.messages).toEqual([]);
      } finally {
        restoreGeometry();
      }
    }
  });

  it("fails closed when a positioned pseudo-element may paint over message text", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout><span class="message-overlay">covered request</span></div></article>
    `;
    const view = replayDocument.defaultView!;
    const nativeGetComputedStyle = view.getComputedStyle.bind(view);
    const computedStyle = vi
      .spyOn(view, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = nativeGetComputedStyle(element, pseudo);
        if (pseudo !== "::after" || !element.matches(".message-overlay")) {
          return style;
        }
        return new Proxy(style, {
          get(target, property) {
            if (property === "content") return '""';
            if (property === "position") return "fixed";
            return Reflect.get(target, property, target);
          },
        }) as CSSStyleDeclaration;
      });

    try {
      expect(() =>
        extractVisibleReplayUserMessages(replayDocument, 100, 100, "now"),
      ).toThrow("replay_text_occlusion_unverifiable");
    } finally {
      computedStyle.mockRestore();
      restoreGeometry();
    }
  });

  it("omits text hidden by opacity, blur, transparency, and text masking", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout style="filter: opacity(0)">filtered request</div></article>
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout style="filter: blur(2px)">blurred request</div></article>
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout style="-webkit-text-fill-color: transparent">transparent request</div></article>
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout style="-webkit-text-security: disc">masked request</div></article>
    `;

    try {
      expect(
        extractVisibleReplayUserMessages(replayDocument, 100, 100, "now")
          .messages,
      ).toEqual([]);
    } finally {
      restoreGeometry();
    }
  });

  it("bounds hidden DOM text scanning and reports truncated coverage", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content"><span style="display: none">${"x".repeat(32_001)}</span><span data-layout>visible request after hidden text</span></div></article>
    `;

    try {
      const result = extractVisibleReplayUserMessages(
        replayDocument,
        100,
        100,
        "now",
      );
      expect(result.messages).toEqual([]);
      expect(result.truncatedCharacters).toBe(true);
      expect(result.truncatedMessages).toBe(true);
    } finally {
      restoreGeometry();
    }
  });

  it("caps synchronous hit tests and keeps the visible prefix when a message is long", () => {
    const replayDocument = document;
    const hitTestCalls = { count: 0 };
    const restoreGeometry = mockReplayGeometry(replayDocument, hitTestCalls);
    const visiblePrefix = "x".repeat(1_024);
    replayDocument.body.innerHTML =
      '<article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>' +
      "x".repeat(1_500) +
      "</div></article>";

    try {
      const result = extractVisibleReplayUserMessages(
        replayDocument,
        100,
        100,
        "now",
      );
      expect(result.messages).toEqual([{ role: "user", text: visiblePrefix }]);
      expect(result.truncatedCharacters).toBe(true);
      expect(result.truncatedMessages).toBe(true);
      expect(hitTestCalls.count).toBeLessThanOrEqual(1_024);
    } finally {
      restoreGeometry();
    }
  });

  it("does not split a surrogate pair at the text scan boundary", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    const visiblePrefix = "x".repeat(1_023);
    replayDocument.body.innerHTML =
      '<article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>' +
      visiblePrefix +
      "🌟after</div></article>";

    try {
      const result = extractVisibleReplayUserMessages(
        replayDocument,
        100,
        100,
        "now",
      );
      expect(result.messages).toEqual([{ role: "user", text: visiblePrefix }]);
      expect(result.truncatedCharacters).toBe(true);
      expect(result.truncatedMessages).toBe(true);
    } finally {
      restoreGeometry();
    }
  });

  it("bounds traversal across text nodes as well as elements", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    const manyTextNodes = Array.from(
      { length: 4_200 },
      () => "<span>x</span>",
    ).join("");
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content">${manyTextNodes}</div></article>
    `;

    try {
      expect(() =>
        extractVisibleReplayUserMessages(replayDocument, 100, 100, "now"),
      ).toThrow("replay_text_dom_limit_exceeded");
    } finally {
      restoreGeometry();
    }
  });

  it("bounds deeply nested replay DOM before walking ancestors", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    const article = replayDocument.createElement("article");
    article.className = "agentkit-message";
    article.dataset.role = "user";
    const content = replayDocument.createElement("div");
    content.className = "agentkit-user-message-text-content";
    let parent: HTMLElement = content;
    for (let depth = 0; depth < 130; depth++) {
      const child = replayDocument.createElement("span");
      parent.append(child);
      parent = child;
    }
    parent.textContent = "deep request";
    article.append(content);
    replayDocument.body.replaceChildren(article);

    try {
      expect(() =>
        extractVisibleReplayUserMessages(replayDocument, 100, 100, "now"),
      ).toThrow("replay_text_dom_limit_exceeded");
    } finally {
      restoreGeometry();
    }
  });

  it("fails closed when replay text hit testing is unavailable", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = `
      <article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>visible request</div></article>
    `;
    Object.defineProperty(replayDocument, "elementFromPoint", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(() =>
        extractVisibleReplayUserMessages(replayDocument, 100, 100, "now"),
      ).toThrow("replay_text_occlusion_unverifiable");
    } finally {
      restoreGeometry();
    }
  });

  it("bounds visible message count with explicit truncation", () => {
    const replayDocument = document;
    const restoreGeometry = mockReplayGeometry(replayDocument);
    replayDocument.body.innerHTML = Array.from(
      { length: 13 },
      () =>
        '<article class="agentkit-message" data-role="user"><div class="agentkit-user-message-text-content" data-layout>' +
        "x".repeat(10) +
        "</div></article>",
    ).join("");

    try {
      const result = extractVisibleReplayUserMessages(
        replayDocument,
        10,
        10,
        "now",
      );
      expect(result.messages).toHaveLength(12);
      expect(result.messages.map(({ text }) => text.length)).toEqual(
        Array.from({ length: 12 }, () => 10),
      );
      expect(result.truncatedMessages).toBe(true);
      expect(result.truncatedCharacters).toBe(false);
    } finally {
      restoreGeometry();
    }
  });
});

describe("blobToBase64", () => {
  it("returns the bytes without the data URL prefix", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    expect(await blobToBase64(blob)).toBe("iVBORw==");
  });
});
