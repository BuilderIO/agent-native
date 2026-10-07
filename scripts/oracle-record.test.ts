import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRecorderManifest,
  requireSelectedDesignProbe,
} from "./oracle-record.ts";

const validManifest = {
  id: "fig.inspector.empty-fill-title",
  claim: "Empty Fill title opens the picker.",
  area: "inspector.fill",
  gesture: "Click the empty Fill title once.",
  nativeObservation: "Figma adds the default fill and opens its picker.",
  operator: "Steve",
  measuredBy: "figma-desktop-app-click",
  trials: "One raw pointer click.",
  figmaPageName: "oracle-probes",
  probeMarker: "AN-ORACLE-PROBE:fig.inspector.empty-fill-title",
  designId: "local-design-123",
  values: { fill: "#D9D9D9" },
};

describe("oracle-record manifest", () => {
  it("accepts a complete local probe manifest", () => {
    assert.deepEqual(parseRecorderManifest(validManifest), validManifest);
  });

  it("requires the matching Design probe layer to be selected", () => {
    const marker = validManifest.probeMarker;
    assert.doesNotThrow(() =>
      requireSelectedDesignProbe(marker, [marker], [marker]),
    );
    assert.throws(
      () => requireSelectedDesignProbe(marker, [marker], ["a different layer"]),
      /must select exactly the marked oracle probe layer/,
    );
    assert.throws(
      () => requireSelectedDesignProbe(marker, [marker, marker], [marker]),
      /must select exactly the marked oracle probe layer/,
    );
    assert.throws(
      () => requireSelectedDesignProbe(marker, [], [marker]),
      /must select exactly the marked oracle probe layer/,
    );
  });

  it("rejects an invalid id and a marker for a different page", () => {
    assert.throws(
      () => parseRecorderManifest({ ...validManifest, id: "../../private" }),
      /id must match fig\.<area>\.<slug>/,
    );
    assert.throws(
      () => parseRecorderManifest({ ...validManifest, probeMarker: "Page 1" }),
      /probeMarker must equal/,
    );
  });

  it("rejects a production-like Design id and unsupported measurement method", () => {
    assert.throws(
      () => parseRecorderManifest({ ...validManifest, designId: "id/../prod" }),
      /designId must be a local Design id/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({ ...validManifest, measuredBy: "figma-rest" }),
      /unsupported measuredBy method/,
    );
    assert.throws(
      () => parseRecorderManifest({ ...validManifest, values: {} }),
      /manifest values must include the measured observables/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({
          ...validManifest,
          values: { nested: { figmaFileKey: "must-not-be-committed" } },
        }),
      /private Figma locators are not accepted/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({
          ...validManifest,
          figmaPageName: "https://www.figma.com/design/example-file-id/Probe",
        }),
      /private Figma locators are not accepted/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({
          ...validManifest,
          values: {
            comparison: "Open https://www.figma.com/file/example-file-id/Probe",
          },
        }),
      /private Figma locators are not accepted/,
    );
  });
});
