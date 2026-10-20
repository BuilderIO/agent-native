// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  resolveSlideAssetReference,
  resolveSlideWorkerMarkup,
} from "./protocol";

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

describe("sandbox worker media mapping", () => {
  it("maps direct video and poster handles to configured uploaded asset URLs", () => {
    const markup = resolveSlideWorkerMarkup(
      '<video controls src="asset://video-1" poster="asset://poster-1"></video>',
      runtime,
      appOrigin,
      [assetOrigin],
      resolveSlideAssetReference,
    );

    expect(markup).toContain(`src="${videoUrl}"`);
    expect(markup).toContain(`poster="${posterUrl}"`);
  });

  it.each([
    [
      "external video URL",
      '<video src="https://attacker.example/clip.mp4"></video>',
    ],
    ["malformed video handle", '<video src="asset://../clip.mp4"></video>'],
    ["missing video handle", '<video src="asset://missing"></video>'],
    [
      "external poster URL",
      `<video src="asset://video-1" poster="https://attacker.example/poster.webp"></video>`,
    ],
    [
      "malformed poster handle",
      '<video src="asset://video-1" poster="asset://../poster.webp"></video>',
    ],
    [
      "missing poster handle",
      '<video src="asset://video-1" poster="asset://missing"></video>',
    ],
  ])("rejects %s", (_label, html) => {
    expect(() =>
      resolveSlideWorkerMarkup(
        html,
        runtime,
        appOrigin,
        [assetOrigin],
        resolveSlideAssetReference,
      ),
    ).toThrow();
  });

  it("rejects event handlers before inserting the rendered markup", () => {
    expect(() =>
      resolveSlideWorkerMarkup(
        '<video src="asset://video-1" onerror="fetch(\'https://attacker.example\')"></video>',
        runtime,
        appOrigin,
        [assetOrigin],
        resolveSlideAssetReference,
      ),
    ).toThrow(/executable attribute/);
  });
});
