// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { createBrowserDiagnosticsCapture } from "./browser-diagnostics-capture";

describe("browser diagnostics capture", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState({}, "", "/");
  });

  it("records redacted interaction markers alongside diagnostics", () => {
    const button = document.createElement("button");
    button.id = "submit";
    document.body.append(button);

    const capture = createBrowserDiagnosticsCapture();
    button.click();
    window.history.pushState({}, "", "/next?token=secret");

    const snapshot = capture.stop();

    expect(snapshot.interactionEvents?.map((event) => event.kind)).toEqual([
      "navigation",
      "click",
      "navigation",
    ]);
    expect(snapshot.interactionEvents?.[1]).toMatchObject({
      kind: "click",
      target: "button#submit",
    });
    expect(snapshot.interactionEvents?.[2]?.url).toBe(
      "/next?token=%3Credacted%3E",
    );
    expect(snapshot.timeline?.map((event) => event.kind)).toContain("click");
    capture.dispose();
  });

  it("records an opaque fetch response's status as undefined, not 0", async () => {
    const originalFetch = window.fetch;
    window.fetch = (() =>
      Promise.resolve({
        status: 0,
        statusText: "",
        ok: false,
      })) as unknown as typeof window.fetch;

    const capture = createBrowserDiagnosticsCapture();
    await window.fetch("https://example.com/opaque");
    const snapshot = capture.stop();
    window.fetch = originalFetch;

    expect(snapshot.networkRequests[0]?.type).toBe("fetch");
    expect(snapshot.networkRequests[0]?.status).toBeUndefined();
    capture.dispose();
  });

  it("does not remove a newer history wrapper during cleanup", () => {
    const originalPushState = window.history.pushState;
    const capture = createBrowserDiagnosticsCapture();
    const newerPushState = function newerPushState(
      this: History,
      state: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      return originalPushState.call(this, state, unused, url);
    };
    window.history.pushState = newerPushState;

    capture.stop();
    expect(window.history.pushState).toBe(newerPushState);

    window.history.pushState = originalPushState;
    capture.dispose();
  });
});
