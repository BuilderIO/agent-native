import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("recorder browser diagnostics boundary", () => {
  it("freezes diagnostics before transcript and media finalization", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );
    const stopStart = route.indexOf("const doStop = useCallback(async () => {");
    const stopEnd = route.indexOf("// Keep the ref current", stopStart);
    const stopFlow = route.slice(stopStart, stopEnd);
    const diagnosticsStop = stopFlow.indexOf(
      "const diagnosticsSave = saveBrowserDiagnostics(pending.id)",
    );
    const transcriptStop = stopFlow.indexOf("liveTranscription.stopAndWait()");
    const mediaStop = stopFlow.indexOf("await engine.stop()");

    expect(stopStart).toBeGreaterThan(-1);
    expect(diagnosticsStop).toBeGreaterThan(-1);
    expect(diagnosticsStop).toBeLessThan(transcriptStop);
    expect(diagnosticsStop).toBeLessThan(mediaStop);
    expect(stopFlow.match(/await diagnosticsSave;/g)).toHaveLength(2);
  });
});
