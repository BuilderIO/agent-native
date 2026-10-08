import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
  captureSelectedDesignProbe,
  captureSelectedFigmaProbe,
  parseRecorderManifest,
  recordedFigmaMetadata,
  requireExpectedFigmaPage,
  requireStableFigmaPage,
  requireSelectedDesignProbe,
  requireSelectedFigmaProbe,
  readFigmaActivePage,
  readFigmaSelectedProbe,
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

function createFigmaPage(
  response: Record<string, unknown>,
  selectedRows = [validManifest.probeMarker],
) {
  const requests: Array<{ message: any; targetOrigin: string }> = [];
  let screenshotCalls = 0;
  const frame = {
    async evaluate(
      callback: (args: unknown) => unknown,
      args: unknown,
    ): Promise<unknown> {
      let listener: ((event: unknown) => void) | undefined;
      const fakeWindow = {
        addEventListener(_type: string, next: (event: unknown) => void) {
          listener = next;
        },
        removeEventListener(_type: string, next: (event: unknown) => void) {
          if (listener === next) listener = undefined;
        },
        setTimeout(callback: () => void, delay: number) {
          return globalThis.setTimeout(callback, delay);
        },
        clearTimeout(handle: ReturnType<typeof setTimeout>) {
          globalThis.clearTimeout(handle);
        },
        parent: {
          postMessage(message: any, targetOrigin: string) {
            requests.push({ message, targetOrigin });
            queueMicrotask(() =>
              listener?.({
                data: {
                  pluginMessage: {
                    ...response,
                    requestId: message.pluginMessage.requestId,
                  },
                },
              }),
            );
          },
        },
      };
      return await runInNewContext(`(${callback.toString()})(payload)`, {
        __name: (target: unknown) => target,
        window: fakeWindow,
        document: { getElementById: () => ({}) },
        payload: args,
      });
    },
  };
  const page = {
    evaluate: async (_callback: unknown, marker: string) => ({
      available: [marker],
      selected: selectedRows,
    }),
    frames: () => [frame],
    async screenshot() {
      screenshotCalls += 1;
    },
  };
  return {
    page,
    requests,
    get screenshotCalls() {
      return screenshotCalls;
    },
  };
}

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

  it("withholds private Figma page identity from committed metadata", () => {
    assert.deepEqual(recordedFigmaMetadata(), {
      fileKeyWithheld: true,
      pageName: "not captured; private scratch page name withheld",
      appBuild: "not exposed by the native Figma page",
    });
    assert.equal("pageId" in recordedFigmaMetadata(), false);
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

  it("captures only the selected Figma probe through its plugin export", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fixture = createFigmaPage({
      type: "selected-probe",
      marker: validManifest.probeMarker,
      png: Array.from(png),
    });

    assert.deepEqual(
      await captureSelectedFigmaProbe(
        fixture.page,
        "123456789012",
        validManifest.probeMarker,
      ),
      png,
    );
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.requests[0].message)), {
      pluginMessage: {
        type: "export-selected-probe",
        requestId: fixture.requests[0].message.pluginMessage.requestId,
        marker: validManifest.probeMarker,
      },
      pluginId: "123456789012",
    });
    assert.equal(fixture.requests[0].targetOrigin, "https://www.figma.com");
    assert.equal(fixture.screenshotCalls, 0);
  });

  it("rejects a plugin export for a different layer and never falls back to a viewport shot", async () => {
    const fixture = createFigmaPage({
      type: "selected-probe",
      marker: "AN-ORACLE-PROBE:fig.other.layer",
      png: [137, 80, 78, 71],
    });

    await assert.rejects(
      captureSelectedFigmaProbe(
        fixture.page,
        "123456789012",
        validManifest.probeMarker,
      ),
      /Figma probe export did not match the selected marker/,
    );
    assert.equal(fixture.screenshotCalls, 0);
  });

  it("captures the matching Design probe element instead of its whole iframe", async () => {
    const calls: unknown[] = [];
    const page = {
      frameLocator(selector: string) {
        calls.push(["frameLocator", selector]);
        return {
          first() {
            calls.push(["first"]);
            return this;
          },
          locator(selector: string) {
            calls.push(["locator", selector]);
            return {
              count: async () => 1,
              screenshot: async (options: unknown) => {
                calls.push(["screenshot", options]);
              },
            };
          },
        };
      },
    };

    await captureSelectedDesignProbe(
      page,
      validManifest.probeMarker,
      "/tmp/design-oracle-probe.png",
    );

    assert.deepEqual(calls, [
      ["frameLocator", "iframe"],
      ["first"],
      [
        "locator",
        `[data-agent-native-layer-name="${validManifest.probeMarker}"]`,
      ],
      ["screenshot", { path: "/tmp/design-oracle-probe.png" }],
    ]);
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
        {
          frames: () => [
            {
              evaluate: async () => {
                throw new Error("detached frame");
              },
            },
          ],
        },
        "local-plugin-id",
      ),
      /could not inspect a Figma page frame/,
    );
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

  it("declares Figma bridge listeners before arming their timeout", async () => {
    const frame = {
      async evaluate(callback: (args: unknown) => unknown, args: unknown) {
        const fakeWindow = {
          addEventListener() {},
          removeEventListener() {},
          setTimeout(callback: () => void) {
            callback();
            return 1;
          },
          clearTimeout() {},
          parent: { postMessage() {} },
        };
        return runInNewContext(`(${callback.toString()})(payload)`, {
          __name: (target: unknown) => target,
          window: fakeWindow,
          document: { getElementById: () => ({}) },
          payload: args,
        });
      },
    };

    await assert.rejects(
      readFigmaActivePage({ frames: () => [frame] }, "local-plugin-id"),
      /active Figma page bridge returned no page identity/,
    );
    await assert.rejects(
      readFigmaSelectedProbe(
        { frames: () => [frame] },
        "123456789012",
        validManifest.probeMarker,
      ),
      /Figma selected probe bridge returned no export/,
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
      /private Figma locators and page IDs are not accepted/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({
          ...validManifest,
          figmaPageName: "https://www.figma.com/design/example-file-id/Probe",
        }),
      /private Figma locators and page IDs are not accepted/,
    );
    assert.throws(
      () =>
        parseRecorderManifest({
          ...validManifest,
          values: {
            comparison: "Open https://www.figma.com/file/example-file-id/Probe",
          },
        }),
      /private Figma locators and page IDs are not accepted/,
    );
  });

  it("rejects native Figma page IDs in nested measured values", () => {
    for (const values of [
      { fill: "#D9D9D9", pageId: "private-page-id" },
      { fill: "#D9D9D9", capture: { figma_page_id: "private-page-id" } },
    ]) {
      assert.throws(
        () => parseRecorderManifest({ ...validManifest, values }),
        /private Figma locators and page IDs are not accepted/,
      );
    }
  });
});
