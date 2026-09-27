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

  it("only measures natural body content for an explicit Hug screen", () => {
    const out = appendContentSizeReporter(
      "<html><body><main>x</main></body></html>",
    );
    expect(out).toContain("var measurement = measure(usesNaturalHeight());");
    expect(out).toContain("function measure(includeNaturalHeight)");
    expect(out).toContain(
      "naturalHeight: includeNaturalHeight ? naturalMeasure() : null,",
    );
    expect(out).toContain("naturalHeight: naturalHeight");
    expect(out).toContain('meta[data-agent-native-screen-height-mode="hug"]');
    expect(out).toContain("Math.max(body.scrollHeight, body.offsetHeight)");
    expect(out).toContain('body.querySelectorAll("*")');
    expect(out).toContain(
      "window.__agentNativeMeasureNaturalHeight = function ()",
    );
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

  it("does not treat $-patterns in preceding script content as replacement directives", () => {
    const priorScript = '<script>var re = "\\\\$&-$\'-$`";</script>';
    const out = appendContentSizeReporter(
      `<html><body>${priorScript}</body></html>`,
    );
    expect(out).toContain(priorScript);
    expect(out.match(/<\/body>/g)?.length).toBe(1);
  });

  it("does not schedule a measurement for mutations confined to editor chrome", () => {
    const out = appendContentSizeReporter("<body></body>");
    expect(out).toContain("function touchesAuthoredContent(records)");
    expect(out).toContain("if (isChromeNode(record.target)) continue;");
    expect(out).toContain("if (!touchesAuthoredContent(records)) return;");
    const chromeSelector = '"[data-agent-native-edit-overlay]"';
    expect(out).toContain(`el.closest(${chromeSelector})`);
    expect(out).toContain(`document.querySelectorAll(${chromeSelector})`);
  });

  it("treats a childList record as chrome only when every changed node is chrome", () => {
    const out = appendContentSizeReporter("<body></body>");
    expect(out).toContain('record.type === "childList" &&');
    expect(out).toContain("allChromeNodes(record.addedNodes) &&");
    expect(out).toContain("allChromeNodes(record.removedNodes)");
  });
});
