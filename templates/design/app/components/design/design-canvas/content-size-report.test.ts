import { describe, expect, it } from "vitest";

import {
  CONTENT_SIZE_REPORT_MESSAGE_TYPE,
  appendContentSizeReporter,
  resolveStableContentSizeSample,
} from "./content-size-report";

describe("appendContentSizeReporter", () => {
  it("injects the reporter script before </body>", () => {
    const out = appendContentSizeReporter(
      "<html><body><h1>hi</h1></body></html>",
    );
    expect(out).toContain("data-agent-native-content-size-bridge");
    expect(out).toContain(CONTENT_SIZE_REPORT_MESSAGE_TYPE);
    // Injected before the body closes so the script actually runs.
    expect(out.indexOf("content-size-bridge")).toBeLessThan(
      out.indexOf("</body>"),
    );
  });

  it("falls back to </html> then append when there is no </body>", () => {
    expect(appendContentSizeReporter("<html>x</html>")).toContain(
      "content-size-bridge",
    );
    expect(appendContentSizeReporter("plain")).toContain("content-size-bridge");
  });

  it("pins viewport-relative CSS to a device viewport (vh runaway guard)", () => {
    const out = appendContentSizeReporter("<body></body>");
    expect(out).toContain("--agent-native-device-vh");
    expect(out).toContain(".min-h-screen");
    expect(out).toContain(".h-screen");
    expect(out).toContain("remapViewportHeightUnits");
    expect(out).toContain('querySelectorAll("[style]")');
  });

  it("reports its own width so the parent can key by frame", () => {
    const out = appendContentSizeReporter("<body></body>");
    expect(out).toContain("window.innerWidth");
    expect(out).toContain("window.innerHeight");
    expect(out).toContain("scrollHeight");
  });

  it("stops viewport-relative content from chasing a growing iframe", () => {
    const first = resolveStableContentSizeSample(undefined, {
      height: 920,
      viewportHeight: 900,
      width: 1440,
    });
    const second = resolveStableContentSizeSample(first, {
      height: 940,
      viewportHeight: 920,
      width: 1440,
    });
    const third = resolveStableContentSizeSample(second, {
      height: 960,
      viewportHeight: 940,
      width: 1440,
    });

    expect(first.acceptedHeight).toBe(920);
    expect(second.acceptedHeight).toBe(920);
    expect(third.acceptedHeight).toBe(920);
  });

  it("accepts real content growth when the viewport stays fixed", () => {
    const first = resolveStableContentSizeSample(undefined, {
      height: 920,
      viewportHeight: 900,
      width: 1440,
    });
    const next = resolveStableContentSizeSample(first, {
      height: 1320,
      viewportHeight: 900,
      width: 1440,
    });

    expect(next.acceptedHeight).toBe(1320);
  });

  // Regression: html already carries earlier bridge scripts (e.g. editor-chrome's
  // compiled escapeIdent helper contains a literal "$&") by the time this runs.
  // A string second argument to String.replace treats "$&", "$'", "$`" as
  // special substitution patterns instead of literal text, splicing the
  // matched "</body>" into the middle of that prior script and truncating its
  // <script> tag early — which silently killed selection/hover for every
  // embedded screen. The reporter must insert its own text verbatim.
  it("does not treat $-patterns in preceding script content as replacement directives", () => {
    const priorScript = '<script>var re = "\\\\$&-$\'-$`";</script>';
    const out = appendContentSizeReporter(
      `<html><body>${priorScript}</body></html>`,
    );
    expect(out).toContain(priorScript);
    // Only one real </body> should remain — none minted mid-script.
    expect(out.match(/<\/body>/g)?.length).toBe(1);
  });
});
