// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { toCanvasImageUrl } from "../../../../shared/canvas-image-url";
import {
  canvasImageBootstrapMarkup,
  withCanvasImageBootstrap,
  withCanvasRenderSources,
} from "./canvas-image-sources";
import { withLocalRuntimes } from "./local-runtime";

const PHOTO = "https://images.example.test/a/photo.jpg";

describe("canvas render sources", () => {
  it("rewrites remote photos in runtime-localized HTML", () => {
    const html = `<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><img src="${PHOTO}"></body></html>`;
    const out = withCanvasRenderSources(withLocalRuntimes(html));
    const rewritten = toCanvasImageUrl(PHOTO, window.location.origin) ?? "";
    expect(rewritten).not.toBe("");
    expect(out).toContain(`src="${rewritten.replace(/&/g, "&amp;")}"`);
  });

  it("leaves stored-style HTML alone when there is nothing remote", () => {
    const html = '<body><img src="/own.jpg"></body>';
    expect(withCanvasRenderSources(html)).toBe(html);
  });

  it("puts the bootstrap first in the head, before page scripts", () => {
    const html =
      "<html><head><title>x</title><script>window.a=1</script></head><body></body></html>";
    const out = withCanvasImageBootstrap(html);
    expect(
      out.indexOf("data-agent-native-canvas-image-bootstrap"),
    ).toBeLessThan(out.indexOf("window.a=1"));
    expect(out.indexOf("<head>")).toBeLessThan(
      out.indexOf("data-agent-native-canvas-image-bootstrap"),
    );
    expect(canvasImageBootstrapMarkup()).toContain(window.location.origin);
  });
});
