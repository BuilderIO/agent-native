// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import {
  beginNativeRegionExport,
  NATIVE_EDITOR_VIEWPORT_CLIP_RULE,
  NATIVE_REGION_EXPORT_ATTRIBUTE,
} from "./native-region-export";

afterEach(() => {
  document.head.replaceChildren();
  document.documentElement.removeAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE);
});
it("releases only the synthetic editor viewport clip during a region export", () => {
  const style = document.createElement("style");
  style.textContent = NATIVE_EDITOR_VIEWPORT_CLIP_RULE;
  document.head.append(style);
  expect(getComputedStyle(document.documentElement).overflow).toBe("clip");
  const restore = beginNativeRegionExport(document.documentElement);
  expect(getComputedStyle(document.documentElement).overflow).not.toBe("clip");
  restore();
  expect(getComputedStyle(document.documentElement).overflow).toBe("clip");
});
it("preserves authored root clipping and the caller's previous scope value", () => {
  const style = document.createElement("style");
  style.textContent = `html { overflow:hidden } ${NATIVE_EDITOR_VIEWPORT_CLIP_RULE}`;
  document.head.append(style);
  document.documentElement.setAttribute(
    NATIVE_REGION_EXPORT_ATTRIBUTE,
    "outer",
  );
  const restore = beginNativeRegionExport(document.documentElement);
  expect(getComputedStyle(document.documentElement).overflow).toBe("hidden");
  restore();
  expect(
    document.documentElement.getAttribute(NATIVE_REGION_EXPORT_ATTRIBUTE),
  ).toBe("outer");
});
