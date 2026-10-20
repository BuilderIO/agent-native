// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import {
  planNativeCaptureRoi,
  setNativeCaptureRoi,
} from "./native-capture-roi";
import { nativeSourceFrameCommitEpoch } from "./native-source-frame-witness";
import { createNativeSceneProvider } from "./native-source-provider";
import * as svgSource from "./native-svg-source";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 80");
  svg.setAttribute("width", "100");
  svg.setAttribute("height", "80");
  svg.innerHTML = '<path d="M0 0H100V80H0Z"/>';
  svg.getBoundingClientRect = () => new DOMRect(0, 0, 100, 80);
  document.body.append(svg);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: () => "",
    width: "100px",
    height: "80px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    mixBlendMode: "normal",
    filter: "none",
    backdropFilter: "none",
    maskImage: "none",
    backgroundImage: "none",
    overflowX: "hidden",
    overflowY: "hidden",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    borderBottomRightRadius: "0px",
  } as unknown as CSSStyleDeclaration);
  vi.spyOn(svgSource, "rasterNativeSvgSource").mockImplementation(
    async (_element, canvas, density) => {
      const capture = planNativeCaptureRoi({
        ownBox: { x: 0, y: 0, width: 100, height: 80 },
        clipBox: { x: 0, y: 0, width: 100, height: 80 },
        density,
        maxDimension: 4096,
        maxPixels: 8_388_608,
      });
      if (!capture.ok) throw new Error(capture.reason);
      canvas.width = capture.plan.pixelBox.width;
      canvas.height = capture.plan.pixelBox.height;
      setNativeCaptureRoi(canvas, capture.plan);
    },
  );
  const provider = createNativeSceneProvider(svg, "backdrop")!;
  provider.setDensity(2);
  await provider.readReceiverCoverage();
  return { svg, provider };
}
it("commits the raster epoch after lazy receiver coverage changes density without changing authored source", async () => {
  const { provider } = await fixture();
  try {
    provider.setDensity(1);
    const witness = {
      sourceEpoch: provider.sourceEpoch!(),
      authoredSourceEpoch: provider.authoredSourceEpoch!(),
    };
    await provider.readReceiverCoverage();
    expect(provider.sourceEpoch!()).toBeGreaterThan(witness.sourceEpoch);
    expect(provider.authoredSourceEpoch!()).toBe(witness.authoredSourceEpoch);
    expect(nativeSourceFrameCommitEpoch(provider, witness)).toBe(
      provider.sourceEpoch!(),
    );
  } finally {
    provider.dispose();
  }
});
it("rejects a real authored mutation instead of accepting its newer raster epoch", async () => {
  const { svg, provider } = await fixture();
  try {
    const witness = {
      sourceEpoch: provider.sourceEpoch!(),
      authoredSourceEpoch: provider.authoredSourceEpoch!(),
    };
    svg.setAttribute("style", "opacity: 0.5");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => nativeSourceFrameCommitEpoch(provider, witness)).toThrow(
      expect.objectContaining({ code: "source-epoch-stale" }),
    );
  } finally {
    provider.dispose();
  }
});
it("keeps authored and raster epochs stable for identical serialized style writes", async () => {
  const { svg, provider } = await fixture();
  try {
    svg.setAttribute("style", "left: 12px; opacity: 0.5");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await provider.readReceiverCoverage();
    const authored = provider.authoredSourceEpoch!();
    const raster = provider.sourceEpoch!();
    svg.setAttribute("style", svg.getAttribute("style")!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.authoredSourceEpoch!()).toBe(authored);
    expect(provider.sourceEpoch!()).toBe(raster);
    svg.setAttribute("style", "left: 24px; opacity: 0.5");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.authoredSourceEpoch!()).toBeGreaterThan(authored);
  } finally {
    provider.dispose();
  }
});
