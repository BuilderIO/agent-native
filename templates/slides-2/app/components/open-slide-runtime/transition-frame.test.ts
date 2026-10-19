// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  resolveSlideAssetReference,
  resolveSlideWorkerMarkup,
} from "./protocol";
import type { SandboxedSlideRenderResult } from "./SandboxedSlide";
import { buildSlideTransitionSrcDoc } from "./transition-frame";

const appOrigin = "https://slides.example.test";
const assetOrigin = "https://assets.example.test";
const videoUrl = `${assetOrigin}/decks/clip.mp4`;
const posterUrl = `${assetOrigin}/decks/poster.webp`;
const runtime = {
  kind: "open-slide-react-worker-v1" as const,
  workerSource: "self.onmessage = () => {};",
  page: { current: 1, total: 1 },
  assetUrls: { "video-1": videoUrl, "poster-1": posterUrl },
  styles: [],
  timeoutMs: 2500 as const,
};

function snapshot(slideId: string, html: string): SandboxedSlideRenderResult {
  return {
    deckId: "deck-1",
    slideId,
    revision: 1,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html,
    styles: [],
    assetUrls: { "video-1": videoUrl, "poster-1": posterUrl },
    assetOrigins: [assetOrigin],
    stepCount: 0,
  };
}

function buildForHtml(html: string): string {
  const frame = buildSlideTransitionSrcDoc(
    {
      outgoing: snapshot("slide-1", html),
      incoming: snapshot("slide-2", html),
      transition: { duration: 300 },
      direction: "forward",
    },
    appOrigin,
  );
  return frame.srcDoc;
}

describe("slide transition frame media policy", () => {
  it("carries uploaded video and poster handles through sandbox rendering into the transition frame", () => {
    const html = resolveSlideWorkerMarkup(
      '<video controls src="asset://video-1" poster="asset://poster-1"></video>',
      runtime,
      appOrigin,
      [assetOrigin],
      resolveSlideAssetReference,
    );
    const srcDoc = buildForHtml(html);

    expect(srcDoc).toContain(`img-src ${assetOrigin}`);
    expect(srcDoc).toContain(`media-src ${assetOrigin}`);
    expect(srcDoc).toContain(videoUrl);
    expect(srcDoc).toContain(posterUrl);
  });

  it("carries only selected registered font assets through the transition frame", () => {
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
    };
    const fontAsset = {
      assetId: "font-1",
      family: "Inter",
      variant: "400",
      mimeType: "font/woff2",
      url: "https://assets.example.test/fonts/inter.woff2",
    };
    const outgoing = snapshot("slide-1", "<div>One</div>");
    const incoming = snapshot("slide-2", "<div>Two</div>");
    for (const slide of [outgoing, incoming]) {
      slide.designTokens = tokens;
      slide.fontOrigins = [assetOrigin];
      slide.fontAssets = [fontAsset];
    }

    const frame = buildSlideTransitionSrcDoc(
      {
        outgoing,
        incoming,
        transition: { duration: 300 },
        direction: "forward",
      },
      appOrigin,
    );

    expect(frame.srcDoc).toContain(`font-src ${assetOrigin}`);
    expect(frame.srcDoc).toContain(`url(\"${fontAsset.url}\")`);
    expect(frame.srcDoc).not.toContain("font-src 'none'");
  });

  it.each([
    [
      "an external video URL",
      `<video src="https://attacker.example/clip.mp4" poster="${posterUrl}"></video>`,
    ],
    [
      "an external poster URL",
      `<video src="${videoUrl}" poster="https://attacker.example/poster.webp"></video>`,
    ],
    [
      "a malformed video asset handle",
      '<video src="asset://../clip.mp4" poster="https://assets.example.test/decks/poster.webp"></video>',
    ],
    [
      "a malformed poster asset handle",
      `<video src="${videoUrl}" poster="asset://../poster.webp"></video>`,
    ],
  ])("rejects %s", (_label, html) => {
    expect(() => buildForHtml(html)).toThrow(
      "invalid-slide-transition-snapshot",
    );
  });

  it("rejects poster attributes outside video elements", () => {
    expect(() =>
      buildForHtml(`<img src="${posterUrl}" poster="${posterUrl}">`),
    ).toThrow("invalid-slide-transition-snapshot");
  });
});
