// @vitest-environment happy-dom

import {
  safeParseBrowserContextV1,
  type BrowserReadableProjectionV1,
} from "@agent-native/core/browser-context";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import {
  extractReadableBrowserContext,
  type CaptureWindow,
} from "./browser-context";

function createPage(url = "https://example.com/profile?accessToken=example") {
  const pageWindow = new Window({ url });
  return {
    pageWindow,
    document: pageWindow.document as unknown as Document,
    captureWindow: pageWindow as unknown as CaptureWindow,
  };
}

function readableProjection(
  context: ReturnType<typeof extractReadableBrowserContext>,
): BrowserReadableProjectionV1 {
  if (context.outcome.state === "failure") {
    throw new Error("Expected readable context.");
  }
  return context.outcome.projections[0] as BrowserReadableProjectionV1;
}

describe("readable browser context extraction", () => {
  it("captures visible readable structure without form, hidden, or editable values", () => {
    const page = createPage();
    page.document.title = " Example Profile ";
    page.document.body.innerHTML = `
      <main>
        <h1>Example Person</h1>
        <p>Engineering leader</p>
        <p hidden>hidden attribute secret</p>
        <p style="display:none">display secret</p>
        <div aria-hidden="true">aria secret</div>
        <input value="input secret" />
        <textarea>textarea secret</textarea>
        <div contenteditable="plaintext-only">draft secret</div>
        <div contenteditable="false">published text</div>
        <a href="/company?sessionKey=example">Example Company</a>
      </main>
    `;

    const context = extractReadableBrowserContext(
      page.document,
      page.captureWindow,
      {
        captureId: "capture-example",
        capturedAt: "2026-07-29T18:00:00.000Z",
      },
    );
    const serialized = JSON.stringify(context);
    const readable = readableProjection(context);

    expect(safeParseBrowserContextV1(context).success).toBe(true);
    expect(context.page.url).toContain("accessToken=%3Credacted%3E");
    expect(readable.text).toContain("Example Person");
    expect(readable.text).toContain("published text");
    expect(readable.blocks).toContainEqual({
      role: "heading",
      level: 1,
      text: "Example Person",
    });
    expect(readable.links?.[0]).toEqual({
      label: "Example Company",
      url: "https://example.com/company?sessionKey=%3Credacted%3E",
    });
    expect(serialized).not.toContain("hidden attribute secret");
    expect(serialized).not.toContain("display secret");
    expect(serialized).not.toContain("aria secret");
    expect(serialized).not.toContain("input secret");
    expect(serialized).not.toContain("textarea secret");
    expect(serialized).not.toContain("draft secret");
    expect(serialized).not.toContain("<main>");
  });

  it("bounds every projection and reports truncation explicitly", () => {
    const page = createPage("https://example.com/long");
    page.document.body.innerHTML = `<main>${Array.from(
      { length: 120 },
      (_, index) =>
        `<p>${index}-${"paragraph ".repeat(90)}</p><a href="/${index}?token=example">Link ${index}</a>`,
    ).join("")}</main>`;

    const context = extractReadableBrowserContext(
      page.document,
      page.captureWindow,
    );
    const readable = readableProjection(context);
    const byteSize = new TextEncoder().encode(
      JSON.stringify(context),
    ).byteLength;

    expect(context.outcome.state).toBe("truncated");
    expect(readable.status.state).toBe("truncated");
    expect(readable.blocks?.length).toBeLessThanOrEqual(32);
    expect(readable.links?.length).toBeLessThanOrEqual(24);
    expect(readable.text.length).toBeLessThanOrEqual(24_000);
    expect(byteSize).toBeLessThanOrEqual(96 * 1024);
    expect(safeParseBrowserContextV1(context).success).toBe(true);
  });
});
