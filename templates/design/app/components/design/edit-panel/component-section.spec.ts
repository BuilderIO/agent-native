// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { isMessageFromOwnPreviewIframe } from "./component-section";

// ---------------------------------------------------------------------------
// isMessageFromOwnPreviewIframe — message.source validation for the
// "element-select" listener (Bug: component-section's window "message"
// listener trusted event.data with zero event.source/event.origin
// validation, unlike every other bridge listener in the app).
// ---------------------------------------------------------------------------

describe("isMessageFromOwnPreviewIframe", () => {
  function appendPreviewIframe(): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.appendChild(iframe);
    return iframe;
  }

  it("returns false when there is no source window", () => {
    expect(isMessageFromOwnPreviewIframe(null)).toBe(false);
  });

  it("returns false when the source is not one of our own preview iframes", () => {
    appendPreviewIframe();
    const otherIframe = document.createElement("iframe");
    document.body.appendChild(otherIframe);

    expect(isMessageFromOwnPreviewIframe(otherIframe.contentWindow)).toBe(
      false,
    );

    document.body.removeChild(otherIframe);
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("returns true when the source matches a design-preview iframe's contentWindow", () => {
    const iframe = appendPreviewIframe();

    expect(isMessageFromOwnPreviewIframe(iframe.contentWindow)).toBe(true);

    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("returns true when multiple preview iframes are present and the source matches any of them", () => {
    appendPreviewIframe();
    const second = appendPreviewIframe();

    expect(isMessageFromOwnPreviewIframe(second.contentWindow)).toBe(true);

    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });
});
