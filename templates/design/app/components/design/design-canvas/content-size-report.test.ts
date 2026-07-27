import { describe, expect, it } from "vitest";

import {
  CONTENT_SIZE_REPORT_MESSAGE_TYPE,
  appendContentSizeReporter,
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

  it("pins full-height utilities to a device-viewport var (vh runaway guard)", () => {
    const out = appendContentSizeReporter("<body></body>");
    // The guard remaps min-h-screen/h-screen etc. to --agent-native-device-vh
    // so a full-viewport hero stays one device tall and scrollHeight is stable.
    expect(out).toContain("--agent-native-device-vh");
    expect(out).toContain(".min-h-screen");
    expect(out).toContain(".h-screen");
  });

  it("reports its own width so the parent can key by frame", () => {
    const out = appendContentSizeReporter("<body></body>");
    expect(out).toContain("window.innerWidth");
    expect(out).toContain("scrollHeight");
  });
});
