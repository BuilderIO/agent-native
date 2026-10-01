import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");

describe("record first, connect storage after", () => {
  const start = source.slice(
    source.indexOf("async function handleStartRecording("),
    source.indexOf("const recordingPromise = startRecording("),
  );

  it("starts a recording with no storage connected instead of opening setup", () => {
    expect(start).not.toContain("openVideoStorageSetup()");
    expect(start).toContain(
      'localRecordingMode === "off" && videoStorageStatus === "missing"',
    );
  });

  it("writes that recording to a local file, then asks for storage", () => {
    expect(source).toMatch(
      /localRecordingMode: recordLocallyUntilStorage\s*\?\s*"composed"/,
    );
    const stop = source.slice(
      source.indexOf("finishRecordingStopRef.current = async"),
      source.indexOf("async function retryPendingUpload("),
    );
    expect(stop).toMatch(
      /if \(recordedWithoutStorageRef\.current\) \{[\s\S]*?setRecError\(STORAGE_SETUP_HELP_TEXT\)/,
    );
  });

  it("sends Connect storage to the setup card, not the recorder", () => {
    expect(source).toContain("/record?connectStorage=1");
  });
});
