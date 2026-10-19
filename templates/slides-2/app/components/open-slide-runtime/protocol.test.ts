import { describe, expect, it } from "vitest";

import { MAX_RENDERED_SLIDE_HTML_LENGTH } from "./constants";
import {
  buildSlideSrcDoc,
  buildSlideFontFaceCss,
  isSlideFrameMessage,
  isSlideRenderArtifact,
  resolveSlideAssetReference,
  type SlideFrameContext,
  type SlideRenderArtifact,
} from "./protocol";

const appOrigin = "https://slides-2.agent-native.com";

function artifact(
  runtimeOverrides: Partial<NonNullable<SlideRenderArtifact["runtime"]>> = {},
): SlideRenderArtifact {
  return {
    protocolVersion: 1,
    deckId: "deck-1",
    slideId: "slide-1",
    revision: 2,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html: "",
    assetOrigins: [],
    runtime: {
      kind: "open-slide-react-worker-v1",
      workerSource: "self.onmessage = () => {};",
      page: { current: 1, total: 1 },
      assetUrls: {},
      styles: [],
      timeoutMs: 2500,
      ...runtimeOverrides,
    },
  };
}

const context: SlideFrameContext = {
  deckId: "deck-1",
  slideId: "slide-1",
  revision: 2,
  sourceHash: "a".repeat(64),
  nonce: "nonce-1",
};

describe("OpenSlide sandbox protocol", () => {
  it("accepts a bounded React Worker artifact and requires its deck identity", () => {
    expect(isSlideRenderArtifact(artifact(), appOrigin)).toBe(true);
    expect(
      isSlideRenderArtifact(
        artifact({ page: { current: 41, total: 41 } }),
        appOrigin,
      ),
    ).toBe(true);
    expect(
      isSlideRenderArtifact(
        artifact({
          page: { current: 1, total: Number.MAX_SAFE_INTEGER + 1 },
        }),
        appOrigin,
      ),
    ).toBe(false);
    expect(
      isSlideRenderArtifact(
        artifact({ workerSource: "x".repeat(4 * 1024 * 1024 + 1) }),
        appOrigin,
      ),
    ).toBe(false);
    expect(
      isSlideRenderArtifact({ ...artifact(), deckId: "" }, appOrigin),
    ).toBe(false);
  });

  it.each([
    ".x{background-image:url(https://attacker.example/pixel)}",
    ".x{background-image:\\75rl(https://attacker.example/pixel)}",
    ".x{background-image:u/**/rl(https://attacker.example/pixel)}",
    "@import url(https://attacker.example/style.css)",
  ])("rejects runtime CSS that could load remote media: %s", (style) => {
    expect(
      isSlideRenderArtifact(artifact({ styles: [style] }), appOrigin),
    ).toBe(false);
  });

  it("allows deck-token variables and builds a blob-worker-only CSP", () => {
    const value = artifact({
      styles: ["#slide-root :is(.title){color:var(--deck-ink)}"],
    });
    expect(isSlideRenderArtifact(value, appOrigin)).toBe(true);
    const srcDoc = buildSlideSrcDoc(value, context.nonce, appOrigin);
    expect(srcDoc).toContain("worker-src blob:");
    expect(srcDoc).toContain("media-src 'none'");
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain('"deckId":"deck-1"');
  });

  it("loads only registered font assets through an origin-scoped font CSP", () => {
    const fontUrl = "https://assets.example.test/fonts/inter-400.woff2";
    const value: SlideRenderArtifact = {
      ...artifact(),
      designTokens: {
        background: "#ffffff",
        text: "#111827",
        accent: "#2563eb",
        displayFont: "Inter",
        displayFontAssetId: "font-1",
        bodyFont: "Arial",
        heroScale: 1,
        bodyScale: 1,
        radius: 12,
      },
      fontOrigins: ["https://assets.example.test"],
      fontAssets: [
        {
          assetId: "font-1",
          family: "Inter",
          variant: "400",
          mimeType: "font/woff2",
          url: fontUrl,
        },
      ],
    };

    expect(isSlideRenderArtifact(value, appOrigin)).toBe(true);
    const srcDoc = buildSlideSrcDoc(value, context.nonce, appOrigin);
    expect(srcDoc).toContain("font-src https://assets.example.test");
    expect(srcDoc).toContain(`url(\"${fontUrl}\") format(\"woff2\")`);
    expect(srcDoc).not.toContain("fonts.googleapis.com");
    expect(srcDoc).not.toContain("fonts.gstatic.com");
  });

  it("allows loopback storage on another port only from a loopback app", () => {
    const localOrigin = "http://localhost:8080";
    const fontUrl = "http://127.0.0.1:9000/fonts/inter.woff2";
    const value: SlideRenderArtifact = {
      ...artifact(),
      assetOrigins: ["http://localhost:9000"],
      designTokens: {
        background: "#ffffff",
        text: "#111827",
        accent: "#2563eb",
        displayFont: "Inter",
        displayFontAssetId: "font-1",
        bodyFont: "Arial",
        heroScale: 1,
        bodyScale: 1,
        radius: 12,
      },
      fontOrigins: ["http://127.0.0.1:9000"],
      fontAssets: [
        {
          assetId: "font-1",
          family: "Inter",
          variant: "400",
          mimeType: "font/woff2",
          url: fontUrl,
        },
      ],
    };

    expect(isSlideRenderArtifact(value, localOrigin)).toBe(true);
    expect(buildSlideSrcDoc(value, context.nonce, localOrigin)).toContain(
      "font-src http://127.0.0.1:9000",
    );
    expect(isSlideRenderArtifact(value, appOrigin)).toBe(false);
    expect(
      isSlideRenderArtifact(
        { ...value, fontOrigins: ["http://127.0.0.1.evil.test:9000"] },
        localOrigin,
      ),
    ).toBe(false);
    expect(
      isSlideRenderArtifact(
        { ...value, assetOrigins: ["http://192.168.1.12:9000"] },
        localOrigin,
      ),
    ).toBe(false);
  });

  it("rejects unregistered or unlisted font URLs and families", () => {
    const tokens = {
      background: "#ffffff",
      text: "#111827",
      accent: "#2563eb",
      displayFont: "Inter",
      displayFontAssetId: "font-1",
      bodyFont: "Arial",
      heroScale: 1,
      bodyScale: 1,
      radius: 12,
    } as const;
    const asset = {
      assetId: "font-1",
      family: "Inter",
      variant: "400",
      mimeType: "font/woff2",
      url: "https://assets.example.test/fonts/inter.woff2",
    };
    expect(
      isSlideRenderArtifact(
        {
          ...artifact(),
          designTokens: tokens,
          fontOrigins: [],
          fontAssets: [asset],
        },
        appOrigin,
      ),
    ).toBe(false);
    expect(
      isSlideRenderArtifact(
        {
          ...artifact(),
          designTokens: tokens,
          fontOrigins: ["https://assets.example.test"],
          fontAssets: [{ ...asset, family: "Other" }],
        },
        appOrigin,
      ),
    ).toBe(false);
    expect(
      isSlideRenderArtifact(
        {
          ...artifact(),
          designTokens: tokens,
        },
        appOrigin,
      ),
    ).toBe(false);
  });

  it("emits font-face CSS only from already registered font metadata", () => {
    expect(
      buildSlideFontFaceCss([
        {
          assetId: "font-1",
          family: "Inter",
          variant: "700italic",
          mimeType: "font/woff2",
          url: "https://assets.example.test/fonts/inter.woff2",
        },
      ]),
    ).toContain("font-style:italic;font-weight:700");
  });

  it("forwards pointer downs and passive hover moves without slide targets", () => {
    const srcDoc = buildSlideSrcDoc(artifact(), context.nonce, appOrigin);

    expect(srcDoc).toContain(
      "document.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; emitPointer(event); }, true);",
    );
    expect(srcDoc).toContain(
      "if (pointerId === event.pointerId) emitPointer(event); else if (pointerId === null && event.buttons === 0) emitPointer(event, false);",
    );
    expect(srcDoc).toContain(
      "target: includeTarget ? targetFor(event.target) : null",
    );
    expect(srcDoc).toContain("pointerType: event.pointerType");
    expect(srcDoc).toContain("pointerType: 'mouse'");
  });

  it("tracks the visible instance index and count for each source locator", () => {
    const srcDoc = buildSlideSrcDoc(artifact(), context.nonce, appOrigin);

    expect(srcDoc).toContain("const instanceCounts = new Map();");
    expect(srcDoc).toContain(
      "instanceCounts.set(key, (instanceCounts.get(key) || 0) + 1);",
    );
    expect(srcDoc).toContain("instanceIndex, instanceCounts.get(key)");
    expect(srcDoc).toContain("index, siblings.length");
  });

  it("allows only uploaded asset references and scopes video media-src to their origins", () => {
    const videoUrl = "https://assets.example.test/decks/clip.mp4";
    const posterUrl = "https://assets.example.test/decks/poster.webp";
    const value = artifact({
      assetUrls: { "video-1": videoUrl, "poster-1": posterUrl },
    });
    value.assetOrigins = ["https://assets.example.test"];

    expect(isSlideRenderArtifact(value, appOrigin)).toBe(true);
    expect(
      resolveSlideAssetReference(
        "asset://video-1",
        value.runtime!.assetUrls,
        appOrigin,
        value.assetOrigins,
      ),
    ).toBe(videoUrl);
    const srcDoc = buildSlideSrcDoc(value, context.nonce, appOrigin);
    expect(srcDoc).toContain("img-src https://assets.example.test");
    expect(srcDoc).toContain("media-src https://assets.example.test");
    expect(srcDoc).toContain(videoUrl);
    expect(srcDoc).toContain(posterUrl);
  });

  it.each([
    "https://assets.example.test/decks/clip.mp4",
    "asset://../clip",
    "asset://clip/other",
    "asset://missing",
  ])(
    "rejects external, malformed, and unresolved slide media references: %s",
    (reference) => {
      expect(() =>
        resolveSlideAssetReference(
          reference,
          { clip: "https://assets.example.test/decks/clip.mp4" },
          appOrigin,
          ["https://assets.example.test"],
        ),
      ).toThrow();
    },
  );

  it("rejects an uploaded asset URL whose origin is outside the artifact allowlist", () => {
    expect(() =>
      resolveSlideAssetReference(
        "asset://clip",
        { clip: "https://attacker.example/clip.mp4" },
        appOrigin,
        ["https://assets.example.test"],
      ),
    ).toThrow(/origin is invalid/);
    expect(
      isSlideRenderArtifact(
        {
          ...artifact({
            assetUrls: { clip: "https://attacker.example/clip.mp4" },
          }),
          assetOrigins: ["https://assets.example.test"],
        },
        appOrigin,
      ),
    ).toBe(false);
  });

  it("binds rendered messages to the nonce, deck, slide, revision, and source hash", () => {
    const message = {
      ...context,
      protocolVersion: 1,
      type: "rendered",
      html: '<div data-slide-loc="1:0">Title</div>',
      stepCount: 0,
    };
    expect(isSlideFrameMessage(message, context)).toBe(true);
    expect(
      isSlideFrameMessage({ ...message, deckId: "other-deck" }, context),
    ).toBe(false);
    expect(isSlideFrameMessage({ ...message, stepCount: 501 }, context)).toBe(
      false,
    );
    expect(
      isSlideFrameMessage(
        {
          ...message,
          html: "x".repeat(MAX_RENDERED_SLIDE_HTML_LENGTH + 1),
        },
        context,
      ),
    ).toBe(false);
  });

  it("accepts only bounded text-range style results for the requested source node", () => {
    const message = {
      ...context,
      protocolVersion: 1,
      type: "text-range-style",
      rangeStyle: {
        line: 1,
        column: 0,
        nodeId: "1:0:0",
        start: 1,
        end: 4,
        expectedText: "Hello",
        styles: {
          fontFamily: "Georgia",
          fontSize: "36px",
          fontStyle: "italic",
          fontWeight: "700",
          color: "rgb(18, 52, 86)",
        },
      },
    };
    expect(isSlideFrameMessage(message, context)).toBe(true);
    expect(
      isSlideFrameMessage(
        {
          ...message,
          rangeStyle: {
            ...message.rangeStyle,
            nodeId: "2:0:0",
          },
        },
        context,
      ),
    ).toBe(false);
    expect(
      isSlideFrameMessage(
        {
          ...message,
          rangeStyle: {
            ...message.rangeStyle,
            styles: {
              ...message.rangeStyle.styles,
              fontFamily: "x".repeat(401),
            },
          },
        },
        context,
      ),
    ).toBe(false);
  });
});
