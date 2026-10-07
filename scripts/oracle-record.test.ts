import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRecorderManifest,
  requireExpectedFigmaPage,
  requireStableFigmaPage,
  requireSelectedDesignProbe,
  requireSelectedFigmaProbe,
  readFigmaActivePage,
  withVerifiedFigmaPage,
} from "./oracle-record.ts";

const validManifest = {
  id: "fig.inspector.empty-fill-title",
  claim: "Empty Fill title opens the picker.",
  area: "inspector.fill",
  gesture: "Click the empty Fill title once.",
  nativeObservation: "Figma adds the default fill and opens its picker.",
  operator: "Steve",
  measuredBy: "figma-web-app-click",
  trials: "One raw pointer click.",
  figmaPageName: "oracle-probes",
  probeMarker: "AN-ORACLE-PROBE:fig.inspector.empty-fill-title",
  designId: "local-design-123",
  values: { fill: "#D9D9D9" },
};

describe("oracle-record manifest", () => {
  it("accepts a complete local probe manifest", () => {
    assert.deepEqual(parseRecorderManifest(validManifest), validManifest);
    assert.equal(
      parseRecorderManifest({
        ...validManifest,
        measuredBy: "figma-desktop-app-click",
      }).measuredBy,
      "figma-desktop-app-click",
    );
    assert.equal(
      parseRecorderManifest({
        ...validManifest,
        figmaPageName: " oracle-probes ",
      }).figmaPageName,
      " oracle-probes ",
    );
    assert.equal(
      requireExpectedFigmaPage(" oracle-probes ", {
        id: "1:2",
        name: " oracle-probes ",
        pageChangeCount: 0,
      }).name,
      " oracle-probes ",
    );
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

  it("requires the native Figma probe layer to be selected before capture", () => {
    const marker = validManifest.probeMarker;
    assert.doesNotThrow(() =>
      requireSelectedFigmaProbe(marker, [marker], [marker]),
    );
    assert.throws(
      () => requireSelectedFigmaProbe(marker, [marker], []),
      /Figma must select exactly the marked oracle probe layer/,
    );
    assert.throws(
      () => requireSelectedFigmaProbe(marker, [marker], ["a different layer"]),
      /Figma must select exactly the marked oracle probe layer/,
    );
    assert.throws(
      () => requireSelectedFigmaProbe(marker, [marker, marker], [marker]),
      /Figma must select exactly the marked oracle probe layer/,
    );
  });

  it("requires the live Figma page identity to match the manifest", () => {
    const activePage = {
      id: "1:2",
      name: validManifest.figmaPageName,
      pageChangeCount: 0,
    };
    assert.deepEqual(
      requireExpectedFigmaPage(validManifest.figmaPageName, activePage),
      activePage,
    );
    assert.throws(
      () => requireExpectedFigmaPage("another page", activePage),
      /active Figma page is .*expected another page/,
    );
    assert.throws(
      () => requireExpectedFigmaPage(validManifest.figmaPageName, null),
      /active Figma page bridge returned no page identity/,
    );
    assert.throws(
      () =>
        requireExpectedFigmaPage(validManifest.figmaPageName, { id: "1:2" }),
      /active Figma page bridge returned no page identity/,
    );
    assert.throws(
      () =>
        requireExpectedFigmaPage(validManifest.figmaPageName, {
          ...activePage,
          name: ` ${validManifest.figmaPageName} `,
        }),
      /active Figma page is .*expected/,
    );
  });

  it("checks the active page before capture and rejects a page switch", async () => {
    const expected = {
      id: "1:2",
      name: validManifest.figmaPageName,
      pageChangeCount: 0,
    };
    let captureStarted = false;
    await assert.rejects(
      withVerifiedFigmaPage(
        validManifest.figmaPageName,
        async () => ({ ...expected, name: "wrong page" }),
        async () => {
          captureStarted = true;
        },
      ),
      /active Figma page is .*expected oracle-probes/,
    );
    assert.equal(captureStarted, false);

    assert.throws(
      () =>
        requireStableFigmaPage(expected, {
          id: "1:3",
          name: expected.name,
          pageChangeCount: 0,
        }),
      /active Figma page changed during capture/,
    );
    assert.throws(
      () =>
        requireStableFigmaPage(expected, {
          ...expected,
          pageChangeCount: 2,
        }),
      /active Figma page changed during capture/,
    );

    let reads = 0;
    await assert.rejects(
      withVerifiedFigmaPage(
        validManifest.figmaPageName,
        async () =>
          reads++ === 0 ? expected : { ...expected, pageChangeCount: 2 },
        async () => "staged capture",
      ),
      /active Figma page changed during capture/,
    );
  });

  it("fails closed when the plugin page bridge is missing or unreadable", async () => {
    await assert.rejects(
      readFigmaActivePage(
        { frames: () => [{ evaluate: async () => null }] },
        "local-plugin-id",
      ),
      /active Figma page bridge is missing/,
    );
    await assert.rejects(
      readFigmaActivePage(
        {
          frames: () => [
            { evaluate: async () => ({ found: true, page: null }) },
          ],
        },
        "local-plugin-id",
      ),
      /active Figma page bridge returned no page identity/,
    );
    await assert.rejects(
      readFigmaActivePage(
        {
          frames: () => [
            {
              evaluate: async () => ({
                found: true,
                page: {
                  id: "1:2",
                  name: validManifest.figmaPageName,
                  pageChangeCount: 0,
                },
              }),
            },
            {
              evaluate: async () => ({
                found: true,
                page: {
                  id: "1:2",
                  name: validManifest.figmaPageName,
                  pageChangeCount: 0,
                },
              }),
            },
          ],
        },
        "local-plugin-id",
      ),
      /multiple active Figma page bridges are open/,
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
