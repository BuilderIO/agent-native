import { expect, it, vi } from "vitest";

import {
  assertAuthoringPersistence,
  assertByteIdenticalHtml,
  assertShortcutMarkupAdded,
  assertSlideIsScaled,
  AUTHORING_FUZZ_STYLE_PROPERTIES,
  createRetiredBrowserSessionErrorCorrelator,
  browserSessionNavigationRequestIdentity,
  browserSessionIdAfterRequest,
  authoringFuzzBrowserSessionCorsHeaders,
  authoringFuzzBrowserSessionResponse,
  authoringFuzzLineNavigationKeys,
  authoringFuzzProfileIndex,
  authoringFuzzUnavailableExitCode,
  recordCleanupRequestOutcome,
  canonicalizeAuthoringFuzzPersistence,
  createAuthoringFuzzPlan,
  formatAuthoringFuzzCleanupIssue,
  formatAuthoringFuzzUnavailable,
  findAuthoringFuzzScratchDeckId,
  resolveAuthoringFuzzScratchDeck,
  retryAuthoringFuzzScratchDeckLookup,
  formatAuthoringFuzzFailure,
  finalizeDeferredOutgoingBrowserSessionAbort,
  isConflictResourceConsoleError,
  isBrowserSessionPath,
  isCompetingOutgoingBrowserSessionRequest,
  isCompetingRetiredBrowserSessionTraffic,
  isPostNavigationBrowserSessionTraffic,
  isCaretScrollOnlyChange,
  isExpectedCleanupBrowserSessionHeartbeatConsoleError,
  isExpectedSaveReloadBrowserSessionConsoleError,
  isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace,
  isExpectedOutgoingBrowserSessionNavigationAbort,
  isExpectedSaveReloadRetiredBrowserSessionCorsError,
  isExpectedSaveReloadRetiredBrowserSessionPollWarning,
  isExpectedSaveReloadWatchedRequestAbort as isExpectedSaveReloadAbort,
  isExpectedSaveReloadWatchedRequestCorsConsoleError,
  isExpectedCleanupBrowserSessionPollConsoleError,
  isExpectedCleanupNavigationError,
  isExpectedWatchedRequestCorsError,
  isFirefoxBrowserSessionConsoleError,
  normalizeFirefoxBrowserSessionConsoleError,
  uniquePendingBrowserSessionId,
  lineNavigationKeys,
  outsideAuthoringChangesFor,
  runAuthoringFuzz,
} from "./authoring-fuzz.ts";
import type { Snapshot } from "./lib/in-page.ts";
import {
  canReuseAuthoringFuzzCleanupPage,
  ActionHttpError,
  ActionRequestTimeoutError,
  ActionTransportError,
  CouldNotRun,
  getHarnessUnavailableError,
  isPlaywrightTimeoutFailure,
  isPlaywrightTargetTransportFailure,
  rethrowIfHarnessUnavailable,
  runSetupActionAsCouldNotRun,
  runSetupAsCouldNotRun,
  shouldLookUpAuthoringFuzzScratchDeck,
  shouldUseFreshBrowserPageForCleanup,
  withTimeout,
} from "./run-outcomes.ts";

const isExpectedSameOriginSaveReloadAbort = (
  pathname: string,
  errorText: string,
  activePhase: string,
  method?: string,
  requestWasPendingAtReloadNavigation = false,
  requestAgeMs = Number.POSITIVE_INFINITY,
  requestStartedDuringNavigation = false,
  competingClaimStartedAfterNavigation = false,
) =>
  isExpectedSaveReloadAbort(
    pathname,
    errorText,
    activePhase,
    method,
    requestWasPendingAtReloadNavigation,
    requestAgeMs,
    requestStartedDuringNavigation,
    competingClaimStartedAfterNavigation,
    true,
  );

it("keeps authoring page setup errors out of seed regression results", async () => {
  const browserError = new Error("Target crashed");
  let caught: unknown;

  try {
    await runSetupAsCouldNotRun(
      "could not create authoring fuzz page",
      async () => {
        throw browserError;
      },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(CouldNotRun);
  expect(caught).toMatchObject({
    message: "could not create authoring fuzz page: Error: Target crashed",
  });
  expect(() => rethrowIfHarnessUnavailable(caught)).toThrow(caught);

  const setupError = new CouldNotRun("sign-in request timed out");
  await expect(
    runSetupAsCouldNotRun("could not create authoring fuzz page", async () => {
      throw setupError;
    }),
  ).rejects.toBe(setupError);
});

it("classifies fuzz action transport failures as could-not-run", () => {
  const transportFailure = new ActionTransportError(
    "get-slide-content request failed",
  );
  expect(getHarnessUnavailableError(transportFailure)).toMatchObject({
    message:
      "authoring action transport failed: Error: get-slide-content request failed",
  });

  let caught: unknown;
  try {
    rethrowIfHarnessUnavailable(transportFailure);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(CouldNotRun);
  expect(caught).toMatchObject({
    message:
      "authoring action transport failed: Error: get-slide-content request failed",
  });
  expect(() =>
    rethrowIfHarnessUnavailable(
      new Error("get-slide-content returned HTTP 500"),
    ),
  ).not.toThrow();
  expect(
    getHarnessUnavailableError(
      new Error("get-slide-content returned HTTP 500"),
    ),
  ).toBeNull();
});

it("keeps authoring action and canvas timeouts as seed failures", () => {
  const actionTimeout = new ActionRequestTimeoutError(
    "patch-deck request timed out after 30000ms",
  );
  expect(getHarnessUnavailableError(actionTimeout)).toBeNull();
  expect(() => rethrowIfHarnessUnavailable(actionTimeout)).not.toThrow();

  const canvasTimeout = Object.assign(
    new Error("Timeout 45000ms exceeded while waiting for slide canvas"),
    { name: "TimeoutError" },
  );
  expect(isPlaywrightTimeoutFailure(canvasTimeout)).toBe(true);
  expect(getHarnessUnavailableError(canvasTimeout)).toBeNull();
});

it("preserves earlier authoring regressions when the harness becomes unavailable", () => {
  expect(formatAuthoringFuzzUnavailable("browser transport failed", [])).toBe(
    "browser transport failed",
  );
  expect(
    formatAuthoringFuzzUnavailable("browser transport failed", [
      "seed 1: caret moved",
      "seed 2: saved HTML did not match",
    ]),
  ).toBe(
    "browser transport failed\n" +
      "Earlier authoring regression(s) before the harness became unavailable (2):\n" +
      "- seed 1: caret moved\n" +
      "- seed 2: saved HTML did not match",
  );
});

it("keeps cleanup issues separate from earlier regressions", () => {
  expect(
    formatAuthoringFuzzUnavailable(
      "browser transport failed",
      ["seed 1: caret moved"],
      ["seed 2: scratch deck cleanup failed (HTTP 500)"],
    ),
  ).toBe(
    "browser transport failed\n" +
      "Earlier authoring regression(s) before the harness became unavailable (1):\n" +
      "- seed 1: caret moved\n" +
      "Authoring fuzz cleanup issue(s) (1):\n" +
      "- seed 2: scratch deck cleanup failed (HTTP 500)",
  );
});

it("classifies raw Playwright target failures as could-not-run", () => {
  const targetError = new Error(
    "Protocol error (Runtime.callFunctionOn): Target closed",
  );
  let caught: unknown;
  try {
    rethrowIfHarnessUnavailable(targetError);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(CouldNotRun);
  expect(caught).toMatchObject({
    message: `Playwright target transport failed: ${String(targetError)}`,
  });
  expect(() =>
    rethrowIfHarnessUnavailable(new Error("canvas not found")),
  ).not.toThrow();
  expect(() =>
    rethrowIfHarnessUnavailable(new Error("Timeout 45000ms exceeded")),
  ).not.toThrow();
});

it("recognizes Playwright selector timeouts without treating app errors as setup failures", () => {
  expect(
    isPlaywrightTimeoutFailure(new Error("Timeout 45000ms exceeded")),
  ).toBe(true);
  expect(
    isPlaywrightTimeoutFailure(
      Object.assign(new Error("waiting for selector"), {
        name: "TimeoutError",
      }),
    ),
  ).toBe(true);
  expect(
    isPlaywrightTimeoutFailure(
      new Error("create-deck request timed out after 30000ms"),
    ),
  ).toBe(false);
});

it("classifies authoring sign-in transport failures as setup errors", async () => {
  await expect(
    runSetupAsCouldNotRun("could not sign in authoring fuzz page", async () => {
      throw new TypeError("Failed to fetch");
    }),
  ).rejects.toMatchObject({
    message:
      "could not sign in authoring fuzz page: TypeError: Failed to fetch",
  });
});

it("classifies authoring action transport failures without masking HTTP errors", async () => {
  const setupFailure = await runSetupActionAsCouldNotRun(
    "could not create authoring fuzz deck",
    async () => {
      throw new ActionTransportError(
        "create-deck request transport failure: Failed to fetch",
      );
    },
  ).catch((error) => error);
  expect(setupFailure).toBeInstanceOf(CouldNotRun);
  expect(setupFailure).toMatchObject({
    message:
      "could not create authoring fuzz deck: Error: create-deck request transport failure: Failed to fetch",
  });

  const setupTimeout = new ActionRequestTimeoutError(
    "create-deck request timed out after 30000ms",
  );
  await expect(
    runSetupActionAsCouldNotRun(
      "could not create authoring fuzz deck",
      async () => {
        throw setupTimeout;
      },
    ),
  ).rejects.toBe(setupTimeout);

  const applicationError = new Error("create-deck returned HTTP 500");
  await expect(
    runSetupActionAsCouldNotRun(
      "could not create authoring fuzz deck",
      async () => {
        throw applicationError;
      },
    ),
  ).rejects.toBe(applicationError);

  const unexpectedError = new Error("unexpected action failure");
  await expect(
    runSetupActionAsCouldNotRun(
      "could not create authoring fuzz deck",
      async () => {
        throw unexpectedError;
      },
    ),
  ).rejects.toBe(unexpectedError);
});

it("recognizes Playwright target transport failures only", () => {
  expect(
    isPlaywrightTargetTransportFailure(
      new Error(
        "Execution context was destroyed, most likely because of a navigation",
      ),
    ),
  ).toBe(true);
  expect(
    isPlaywrightTargetTransportFailure(
      new Error("Protocol error (Runtime.callFunctionOn): Target closed"),
    ),
  ).toBe(true);
  expect(
    isPlaywrightTargetTransportFailure(
      new Error("create-deck returned HTTP 500"),
    ),
  ).toBe(false);
  expect(
    isPlaywrightTargetTransportFailure(new Error("canvas not found")),
  ).toBe(false);
  expect(
    isPlaywrightTargetTransportFailure(
      new Error("Target page, context or browser has been closed"),
    ),
  ).toBe(true);
  expect(isPlaywrightTargetTransportFailure(new Error("Target crashed"))).toBe(
    true,
  );
  expect(isPlaywrightTargetTransportFailure(new Error("Page crashed"))).toBe(
    true,
  );
  expect(
    isPlaywrightTargetTransportFailure(
      new Error("Navigation failed because page crashed!"),
    ),
  ).toBe(true);
  expect(
    isPlaywrightTargetTransportFailure(new Error("Timeout 45000ms exceeded")),
  ).toBe(false);
});

it("uses a fresh browser page only after the cleanup target is unavailable", () => {
  expect(
    shouldUseFreshBrowserPageForCleanup(new Error("Target crashed"), false),
  ).toBe(true);
  expect(
    shouldUseFreshBrowserPageForCleanup(new Error("ordinary app error"), true),
  ).toBe(true);
  expect(
    shouldUseFreshBrowserPageForCleanup(
      new Error("get-slide-content returned HTTP 500"),
      false,
    ),
  ).toBe(false);
});

it("does not reuse closed or crashed authoring cleanup pages", () => {
  expect(canReuseAuthoringFuzzCleanupPage(false, false)).toBe(true);
  expect(canReuseAuthoringFuzzCleanupPage(true, false)).toBe(false);
  expect(canReuseAuthoringFuzzCleanupPage(false, true)).toBe(false);
});

it("only retries scratch-deck lookup when a create failure could have committed", () => {
  expect(shouldLookUpAuthoringFuzzScratchDeck(false, null, null)).toBe(false);
  expect(shouldLookUpAuthoringFuzzScratchDeck(true, "deck-1", null)).toBe(
    false,
  );
  expect(
    shouldLookUpAuthoringFuzzScratchDeck(
      true,
      null,
      new ActionHttpError("create-deck", 422),
    ),
  ).toBe(false);
  expect(
    shouldLookUpAuthoringFuzzScratchDeck(
      true,
      null,
      new ActionHttpError("create-deck", 500),
    ),
  ).toBe(true);
  expect(
    shouldLookUpAuthoringFuzzScratchDeck(
      true,
      null,
      new ActionRequestTimeoutError("create-deck request timed out"),
    ),
  ).toBe(true);
  expect(
    shouldLookUpAuthoringFuzzScratchDeck(
      true,
      null,
      new ActionTransportError("create-deck transport failure"),
    ),
  ).toBe(true);
});

it("bounds failure diagnostics when a browser evaluation never resolves", async () => {
  vi.useFakeTimers();
  try {
    const diagnostics = withTimeout(
      "authoring diagnostics",
      10,
      new Promise<never>(() => {}),
    );
    const rejected = expect(diagnostics).rejects.toThrow(
      "authoring diagnostics timed out after 10ms",
    );
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("requires a markdown shortcut to add its result markup", () => {
  expect(() => assertShortcutMarkupAdded("bullet", 0, 1)).not.toThrow();
  expect(() => assertShortcutMarkupAdded("bullet", 1, 1)).toThrow(
    "markdown shortcut did not produce bullet",
  );
});

it("recovers only the exact authoring fuzz scratch deck", () => {
  const title = "[edit-fidelity] authoring fuzz 1 unique-run-id";
  expect(
    findAuthoringFuzzScratchDeckId(
      [
        { id: "older", title: `${title} retry` },
        { id: "scratch", title },
      ],
      title,
    ),
  ).toBe("scratch");
  expect(
    findAuthoringFuzzScratchDeckId(
      [{ id: "older", title: `${title} retry` }],
      title,
    ),
  ).toBeNull();
});

it("distinguishes an absent deck list from a missing scratch deck", () => {
  const title = "[edit-fidelity] authoring fuzz 1 unique-run-id";
  expect(
    resolveAuthoringFuzzScratchDeck(
      { decks: [{ id: "scratch", title }] },
      title,
    ),
  ).toEqual({
    status: "found",
    deckId: "scratch",
  });
  expect(resolveAuthoringFuzzScratchDeck({ decks: [] }, title)).toEqual({
    status: "not-found",
  });
  expect(resolveAuthoringFuzzScratchDeck({}, title)).toEqual({
    status: "missing-decks",
  });
});

it("retries an ambiguous scratch-deck lookup until the created deck appears", async () => {
  const title = "[edit-fidelity] authoring fuzz 1 unique-run-id";
  let lookups = 0;
  let waits = 0;
  let now = 0;

  const recovery = await retryAuthoringFuzzScratchDeckLookup(
    async () => {
      lookups += 1;
      if (lookups === 1) return { decks: [] };
      if (lookups === 2) throw new Error("list-decks transport failure");
      return { decks: [{ id: "scratch", title }] };
    },
    title,
    {
      now: () => now,
      intervalMs: 5_000,
      wait: async (ms) => {
        waits += 1;
        now += ms;
      },
    },
  );

  expect(recovery).toEqual({ status: "found", deckId: "scratch" });
  expect(lookups).toBe(3);
  expect(waits).toBe(2);
});

it("bounds scratch-deck recovery for the full late-create window", async () => {
  let lookups = 0;
  let waits = 0;
  let now = 0;

  const recovery = await retryAuthoringFuzzScratchDeckLookup(
    async () => {
      lookups += 1;
      return { decks: [] };
    },
    "missing scratch deck",
    {
      intervalMs: 5_000,
      now: () => now,
      wait: async (ms) => {
        waits += 1;
        now += ms;
      },
    },
  );

  expect(recovery).toEqual({ status: "not-found" });
  expect(lookups).toBe(12);
  expect(waits).toBe(12);
});

it("preserves a final scratch-deck lookup error after a missing result", async () => {
  const failure = new Error("list-decks request timed out");
  let lookups = 0;
  let now = 0;

  await expect(
    retryAuthoringFuzzScratchDeckLookup(
      async () => {
        lookups += 1;
        if (lookups === 1) return { decks: [] };
        throw failure;
      },
      "missing scratch deck",
      {
        windowMs: 10_000,
        intervalMs: 5_000,
        now: () => now,
        wait: async (ms) => {
          now += ms;
        },
      },
    ),
  ).rejects.toBe(failure);
  expect(lookups).toBe(2);
});

it("keeps the cleanup action and scratch deck id in failure diagnostics", () => {
  expect(
    formatAuthoringFuzzCleanupIssue(
      "could not delete scratch deck",
      "deck-123",
      new Error("Target closed"),
    ),
  ).toBe(
    "could not delete scratch deck [deckId=deck-123]: Error: Target closed",
  );
  expect(
    formatAuthoringFuzzCleanupIssue(
      "could not look up scratch deck",
      null,
      new Error("Target closed"),
    ),
  ).toBe(
    "could not look up scratch deck [deckId=unknown]: Error: Target closed",
  );
});

it("recognizes resource conflicts with or without browser status text", () => {
  expect(
    isConflictResourceConsoleError(
      "Failed to load resource: the server responded with a status of 409 ()",
    ),
  ).toBe(true);
  expect(
    isConflictResourceConsoleError(
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ),
  ).toBe(true);
  expect(
    isConflictResourceConsoleError(
      "Failed to load resource: the server responded with a status of 404 ()",
    ),
  ).toBe(false);
  expect(
    isConflictResourceConsoleError(
      "Failed to load resource: the server responded with a status of 503 ()",
    ),
  ).toBe(false);
});

const authoringSnapshot = (
  y: number,
  color: string,
  props: Record<string, string> = {},
): Snapshot => ({
  records: [
    {
      key: "box:div#0",
      kind: "box",
      inside: false,
      props: { color, ...props },
      rect: { x: 0, y, width: 100, height: 80 },
    },
  ],
  inventory: { elements: 1, visible: 1, hidden: 0, svg: 0, img: 0, style: 0 },
  text: "",
  editedRect: null,
  editedBoxRect: null,
  editedText: null,
});

const protectedMarkerSnapshot = (
  className: string,
  inlineStyle: string,
  props: Record<string, string>,
  protectedStructure = false,
): Snapshot => ({
  ...authoringSnapshot(64, "rgb(0, 0, 0)"),
  records: [
    {
      key: "box:span#0",
      kind: "box",
      inside: true,
      protectedStyle: true,
      ...(protectedStructure ? { protectedStructure: true } : {}),
      className,
      inlineStyle,
      props,
      rect: { x: 0, y: 0, width: 12, height: 12 },
    },
  ],
});

it("gates outside style changes and unmodeled geometry changes", () => {
  const movement = outsideAuthoringChangesFor(
    authoringSnapshot(64, "rgb(0, 0, 0)"),
    authoringSnapshot(-456, "rgb(0, 0, 0)"),
  );
  expect(movement).toHaveLength(1);
  expect(movement[0]).toMatchObject({ prop: "y", inside: false });
  expect(
    outsideAuthoringChangesFor(
      authoringSnapshot(64, "rgb(0, 0, 0)"),
      authoringSnapshot(64, "rgb(255, 0, 0)"),
    ),
  ).toHaveLength(1);
});

it("tracks computed style properties beyond typography and box paint", () => {
  expect(AUTHORING_FUZZ_STYLE_PROPERTIES).toEqual(
    expect.arrayContaining([
      "filter",
      "position",
      "text-decoration-color",
      "text-decoration-style",
      "text-underline-offset",
      "transform",
      "vertical-align",
    ]),
  );
});

it("gates styled bullet marker restyles inside the edited row", () => {
  const changes = outsideAuthoringChangesFor(
    protectedMarkerSnapshot("marker", "color: red", {
      color: "rgb(255, 0, 0)",
    }),
    protectedMarkerSnapshot("marker-changed", "color: blue", {
      color: "rgb(0, 0, 255)",
    }),
  );

  expect(
    changes.flatMap((change) =>
      "prop" in change ? [{ prop: change.prop, inside: change.inside }] : [],
    ),
  ).toEqual(
    expect.arrayContaining([
      { prop: "class", inside: false },
      { prop: "style", inside: false },
      { prop: "color", inside: false },
    ]),
  );
});

it("gates removal or replacement of a marker the edit must preserve", () => {
  const marker = protectedMarkerSnapshot(
    "marker",
    "color: red",
    { color: "rgb(255, 0, 0)" },
    true,
  );
  const empty = { ...protectedMarkerSnapshot("", "", {}), records: [] };

  expect(outsideAuthoringChangesFor(marker, empty)).toHaveLength(1);
  expect(outsideAuthoringChangesFor(empty, marker)).toHaveLength(1);
});

it("allows a block conversion to remove a marker when the row may change", () => {
  const marker = protectedMarkerSnapshot("marker", "color: red", {
    color: "rgb(255, 0, 0)",
  });
  const empty = { ...protectedMarkerSnapshot("", "", {}), records: [] };

  expect(outsideAuthoringChangesFor(marker, empty)).toHaveLength(0);
});

it("ignores one CSS pixel-quantization step in anchored position styles", () => {
  const before = authoringSnapshot(64, "rgb(0, 0, 0)", {
    top: "386.938px",
    "transform-origin": "135px 74.875px",
    transform: "matrix(1, 0, 0, 1, 0, -74.875)",
  });
  const after = authoringSnapshot(64, "rgb(0, 0, 0)", {
    top: "386.922px",
    "transform-origin": "135px 74.883px",
    transform: "matrix(1, 0, 0, 1, 0, -74.883)",
  });

  expect(outsideAuthoringChangesFor(before, after)).toHaveLength(0);
  expect(
    outsideAuthoringChangesFor(
      before,
      authoringSnapshot(64, "rgb(0, 0, 0)", {
        top: "386.8125px",
        "transform-origin": "135px 74.875px",
        transform: "matrix(1, 0, 0, 1, 0, -74.875)",
      }),
    ),
  ).toHaveLength(1);
});

it.each(["transform", "filter", "position", "--fmd-fit-scale"])(
  "gates outside computed-style changes to %s",
  (property) => {
    const before = authoringSnapshot(64, "rgb(0, 0, 0)", {
      [property]: "before",
    });
    const after = authoringSnapshot(64, "rgb(0, 0, 0)", {
      [property]: "after",
    });

    expect(outsideAuthoringChangesFor(before, after)).toContainEqual(
      expect.objectContaining({ prop: property, inside: false }),
    );
  },
);

it("allows only the matching native caret scroll in an overflowing slide", () => {
  const change = [
    {
      key: "box:div.fmd-autofit-scale#0",
      prop: "y",
      a: "64",
      b: "-300",
    },
  ];
  const options = {
    scrollDelta: 364,
    contentGrew: true,
    containerOverflows: true,
    containerStationary: true,
    fitPositionStylesUnchanged: true,
    fitSizeUnchanged: true,
  };
  expect(isCaretScrollOnlyChange(change, options)).toBe(true);
  expect(
    isCaretScrollOnlyChange(change, { ...options, scrollDelta: 362 }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange([{ ...change[0], b: "-118" }], {
      ...options,
      scrollDelta: 182,
    }),
  ).toBe(true);
  expect(
    isCaretScrollOnlyChange(change, { ...options, contentGrew: false }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      containerOverflows: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      containerStationary: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      fitPositionStylesUnchanged: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, { ...options, fitSizeUnchanged: false }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(
      [...change, { key: "box:p#0", prop: "y", a: "0", b: "1" }],
      options,
    ),
  ).toBe(false);
});

function pageAtScale(scale: number) {
  const element = {
    offsetWidth: 100,
    getBoundingClientRect: () => ({ width: scale * 100 }),
  };
  return {
    locator: (selector: string) => ({
      evaluate: (readScale: (element: HTMLElement) => number) =>
        Promise.resolve(readScale(element as HTMLElement)),
      selector,
    }),
  };
}

it("requires corpus authoring output to be changed, saved, and reloaded", () => {
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "edited",
      reloadedHtml: "edited",
    }),
  ).not.toThrow();
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "source",
      reloadedHtml: "source",
    }),
  ).toThrow("authoring flow did not change the persisted slide HTML");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "source",
      savedHtml: "source",
      reloadedHtml: "source",
    }),
  ).toThrow("authoring flow did not change the persisted slide HTML");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "edited",
      reloadedHtml: "source",
    }),
  ).toThrow("reloaded slide HTML differed from the post-edit live slide");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml:
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank">edited</a>',
      savedHtml: '<a href="https://example.com">edited</a>',
      reloadedHtml:
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank">edited</a>',
    }),
  ).not.toThrow();
});

it("canonicalizes every rendered and stored persistence snapshot", async () => {
  const persistence = await canonicalizeAuthoringFuzzPersistence(
    {
      originalHtml: '<p data-slide-text-block="true">before</p>',
      liveHtml: '<p data-slide-text-block="true">after</p>',
      savedHtml: "<p>after</p>",
      reloadedHtml: '<p data-slide-text-block="true">after</p>',
    },
    (html) => html.replaceAll(' data-slide-text-block="true"', ""),
  );
  expect(() => assertAuthoringPersistence(persistence)).not.toThrow();
});

it("requires byte-identical HTML for undo and redo snapshots", () => {
  expect(() =>
    assertByteIdenticalHtml(
      '<p class="a">text</p>',
      '<p class="a">text</p>',
      "undo-all",
    ),
  ).not.toThrow();
  expect(() =>
    assertByteIdenticalHtml(
      '<p class="a b">text</p>',
      '<p class="b a">text</p>',
      "undo-all",
    ),
  ).toThrow("undo-all did not restore byte-identical HTML");
});

it("creates reproducible authoring plans with full command coverage", () => {
  const first = createAuthoringFuzzPlan(42, 500);
  expect(first).toEqual(createAuthoringFuzzPlan(42, 500));
  expect(first).not.toEqual(createAuthoringFuzzPlan(43, 500));
  expect(first).toHaveLength(500);
  expect(
    first.slice(0, 18).map((step) => step.kind === "shortcut" && step.value),
  ).toEqual([
    "- ",
    "* ",
    "+ ",
    "1. ",
    "# ",
    "## ",
    "### ",
    "#### ",
    "> ",
    "--- ",
    "___ ",
    "*** ",
    "**bold**",
    "__bold__",
    "*italic*",
    "_italic_",
    "~~strike~~",
    "`code`",
  ]);
  expect(
    first.slice(18, 26).map((step) => step.kind === "slash" && step.value),
  ).toEqual([
    "paragraph",
    "heading1",
    "heading2",
    "heading3",
    "bulletList",
    "orderedList",
    "quote",
    "divider",
  ]);
  expect(first.slice(26, 61).map((step) => step.kind)).toContain("paste-rich");
  expect(first.map((step) => step.kind)).toContain("quote-exit");
  expect(first.map((step) => step.kind)).toContain("backspace-block-edge");
  expect(first.map((step) => step.kind)).toContain("delete-block-edge");
  const slashPosition = first.findIndex(
    (step) => step.kind === "slash-position",
  );
  expect(slashPosition).toBeGreaterThanOrEqual(0);
  expect(
    first.slice(slashPosition, slashPosition + 3).map((step) => step.kind),
  ).toEqual(["slash-position", "slash-outside", "shortcut-undo"]);
  expect(first.map((step) => step.kind)).toContain("copy-inline");
  expect(() =>
    createAuthoringFuzzPlan(Number.MAX_SAFE_INTEGER + 1, 500),
  ).toThrow("safe integer");
  expect(() => createAuthoringFuzzPlan(42, 0)).toThrow("positive integer");
});

it("runs vertical caret fidelity in the committed absolute profile", () => {
  expect(createAuthoringFuzzPlan(2, 1)).toEqual([
    { kind: "vertical-navigation" },
  ]);
});

it("ends each fuzz plan with an edit after undo and redo operations", () => {
  for (const steps of [51, 52, 61, 500]) {
    for (const seed of [1, 42, 1337]) {
      expect(["undo", "redo", "shortcut-undo", "slash-undo"]).not.toContain(
        createAuthoringFuzzPlan(seed, steps).at(-1)?.kind,
      );
    }
  }
});

it.each([
  ["darwin", "Meta+ArrowLeft", "Meta+ArrowRight"],
  ["linux", "Home", "End"],
  ["win32", "Home", "End"],
])("uses platform line navigation keys on %s", (platform, start, end) => {
  expect(lineNavigationKeys(platform)).toEqual({ start, end });
});

it("uses the caller's line navigation keys for fuzz operations", () => {
  const macKeys = lineNavigationKeys("darwin");
  expect(authoringFuzzLineNavigationKeys("linux", macKeys)).toEqual(macKeys);
  expect(authoringFuzzLineNavigationKeys("linux")).toEqual(
    lineNavigationKeys("linux"),
  );
});

it("captures failed browser-session registration and subroute requests", () => {
  expect(isBrowserSessionPath("/_agent-native/browser-sessions")).toBe(true);
  expect(
    isBrowserSessionPath("/_agent-native/browser-sessions/abc/claim"),
  ).toBe(true);
  expect(isBrowserSessionPath("/_agent-native/browser-sessions-extra")).toBe(
    false,
  );
  expect(isBrowserSessionPath("/_agent-native/actions/patch-deck")).toBe(false);
});

it("isolates authoring fuzz from the unrelated browser-session service", () => {
  expect(
    authoringFuzzBrowserSessionResponse(
      "POST",
      "/_agent-native/browser-sessions",
      {
        sessionId: "fuzz-session",
        session: { id: "fuzz-session", label: "fuzz" },
        actions: [],
      },
    ),
  ).toMatchObject({
    ok: true,
    session: {
      sessionId: "fuzz-session",
      session: { id: "fuzz-session", label: "fuzz" },
      actions: [],
      active: true,
    },
  });
  expect(
    authoringFuzzBrowserSessionResponse(
      "POST",
      "/_agent-native/browser-sessions/fuzz-session/heartbeat",
      { session: { label: "fuzz" } },
    ),
  ).toMatchObject({ ok: true, session: { sessionId: "fuzz-session" } });
  expect(
    authoringFuzzBrowserSessionResponse(
      "POST",
      "/_agent-native/browser-sessions/fuzz-session/requests/claim",
      {},
    ),
  ).toEqual({ ok: true, request: null });
  expect(
    authoringFuzzBrowserSessionResponse(
      "DELETE",
      "/_agent-native/browser-sessions/fuzz-session",
    ),
  ).toEqual({ ok: true, deleted: true });
  expect(
    authoringFuzzBrowserSessionResponse(
      "POST",
      "/_agent-native/browser-sessions/fuzz-session/requests/complete",
      {},
    ),
  ).toBeNull();
  expect(
    authoringFuzzBrowserSessionResponse(
      "GET",
      "/_agent-native/browser-sessions/fuzz-session",
    ),
  ).toBeNull();
  expect(
    authoringFuzzBrowserSessionResponse(
      "POST",
      "/_agent-native/browser-sessions",
      {},
    ),
  ).toEqual({
    ok: false,
    error: "Browser-session registration omitted its id",
  });
});

it("mirrors browser-session CORS for fuzz-only responses and preflights", () => {
  expect(
    authoringFuzzBrowserSessionCorsHeaders("http://localhost:5173"),
  ).toEqual({
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Agent-Native-CSRF",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  });
  expect(authoringFuzzBrowserSessionCorsHeaders()).toEqual({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Agent-Native-CSRF",
  });
  expect(authoringFuzzBrowserSessionCorsHeaders("null")).toEqual({
    "Access-Control-Allow-Origin": "null",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Agent-Native-CSRF",
    Vary: "Origin",
  });
});

it("clears a cleanup finish marker when the same request later fails", () => {
  const finishedAt = new WeakMap<object, number>();
  const request = {};

  recordCleanupRequestOutcome(finishedAt, request, "finished", 10);
  expect(finishedAt.get(request)).toBe(10);

  recordCleanupRequestOutcome(finishedAt, request, "failed", 20);
  expect(finishedAt.has(request)).toBe(false);
});

it("ignores registration aborts only when reload navigation cancels an in-flight request", () => {
  for (const errorText of [
    "Load request cancelled",
    "cancelled",
    "NS_BINDING_ABORTED",
    "net::ERR_ABORTED",
  ]) {
    expect(
      isExpectedSameOriginSaveReloadAbort(
        "/_agent-native/browser-sessions",
        errorText,
        "save/reload",
        "POST",
        true,
        100,
      ),
    ).toBe(true);
  }

  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions",
      "NS_BINDING_ABORTED",
      "save/reload",
      "POST",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions",
      "NS_BINDING_ABORTED",
      "save/reload",
      "POST",
      true,
      9_000,
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions",
      "NS_BINDING_ABORTED",
      "save/reload",
      "GET",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions",
      "Failed to fetch",
      "save/reload",
      "POST",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions",
      "NS_BINDING_ABORTED",
      "step 12",
      "POST",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/heartbeat",
      "NS_BINDING_ABORTED",
      "save/reload",
      "POST",
    ),
  ).toBe(false);
});

it("ignores only known aborts for requests pending at reload navigation", () => {
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-lab-states",
      "NS_BINDING_ABORTED",
      "save/reload",
      undefined,
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-deck-access-status",
      "NS_BINDING_ABORTED",
      "save/reload",
      undefined,
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/claim",
      "NS_BINDING_ABORTED",
      "save/reload",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "save/reload",
      "POST",
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "NS_BINDING_ABORTED",
      "save/reload",
      "POST",
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "cancelled",
      "save/reload",
      "POST",
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "net::ERR_ABORTED",
      "save/reload",
      "POST",
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "step 12",
      "POST",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim-extra",
      "Load request cancelled",
      "save/reload",
      "POST",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "save/reload",
      "GET",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-lab-states",
      "NS_BINDING_ABORTED",
      "step 12",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-lab-states-extra",
      "NS_BINDING_ABORTED",
      "save/reload",
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-lab-states",
      "NS_BINDING_ABORTED",
      "save/reload",
      undefined,
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-deck-access-status",
      "net::ERR_ABORTED",
      "save/reload",
      undefined,
      true,
      100,
    ),
  ).toBe(true);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/actions/get-deck-access-status",
      "net::ERR_ABORTED",
      "step 12",
    ),
  ).toBe(false);
  for (const requestAgeMs of [9_000, 10_000]) {
    expect(
      isExpectedSameOriginSaveReloadAbort(
        "/_agent-native/browser-sessions/session-id/requests/claim",
        "Load request cancelled",
        "save/reload",
        "POST",
        true,
        requestAgeMs,
      ),
    ).toBe(false);
  }
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "save/reload",
      "POST",
      true,
      100,
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedSameOriginSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "save/reload",
      "POST",
      true,
      100,
      false,
      true,
    ),
  ).toBe(false);
});

it("does not suppress cross-origin request aborts", () => {
  expect(
    isExpectedSaveReloadAbort(
      "/_agent-native/browser-sessions/session-id/requests/claim",
      "Load request cancelled",
      "save/reload",
      "POST",
      true,
      100,
      false,
      false,
      false,
    ),
  ).toBe(false);
});

it("ignores only WebKit CORS console errors for requests canceled by reload", () => {
  const url =
    "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim";
  const message = `Fetch API cannot load ${url} due to access control checks.`;
  const candidate = {
    url,
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtReloadNavigation: true,
  };

  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      candidate,
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        ...candidate,
        requestFinishedSuccessfully: true,
        responseStatus: 204,
        settledAgeMs: 13,
      },
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        ...candidate,
        requestFinishedSuccessfully: true,
        responseStatus: 204,
        settledAgeMs: 1_000,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(
      `${message}\n    at fetch (native)`,
      "save/reload",
      [candidate],
    ),
  ).toBe(true);
  const actionUrl =
    "http://localhost:45715/_agent-native/actions/get-lab-states";
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(
      `Fetch API cannot load ${actionUrl} due to access control checks.\n    at fetch (native)`,
      "save/reload",
      [
        {
          url: actionUrl,
          pathname: "/_agent-native/actions/get-lab-states",
          method: "POST",
          ageMs: 100,
          sameOrigin: true,
          requestWasPendingAtReloadNavigation: true,
        },
      ],
    ),
  ).toBe(true);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "step 12", [
      candidate,
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(
      `Fetch API cannot load ${url} because of a CORS error.`,
      "save/reload",
      [candidate],
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        ...candidate,
        url: `${url}-extra`,
        pathname: `${candidate.pathname}-extra`,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      { ...candidate, method: "GET" },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      { ...candidate, requestWasPendingAtReloadNavigation: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      { ...candidate, requestStartedDuringNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      { ...candidate, competingClaimStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      { ...candidate, sameOrigin: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        url,
        pathname: candidate.pathname,
        method: "POST",
        ageMs: 100,
      },
    ]),
  ).toBe(false);
});

it("ignores only an in-flight browser-session claim canceled by cleanup navigation", () => {
  const url =
    "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim";
  const message = `Fetch API cannot load ${url} due to access control checks.`;
  const candidate = {
    url,
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };

  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      candidate,
    ]),
  ).toBe(true);
  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      { ...candidate, sameOrigin: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      { ...candidate, competingClaimStartedAfterNavigation: true },
    ]),
  ).toBe(true);
  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      { ...candidate, requestFinishedSuccessfully: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      { ...candidate, competingRequestStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedWatchedRequestCorsError(message, "step 12", [candidate]),
  ).toBe(false);
  expect(
    isExpectedWatchedRequestCorsError(message, "cleanup/navigation", [
      { ...candidate, requestWasPendingAtNavigation: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(
      message,
      "cleanup/navigation",
      [
        {
          ...candidate,
          requestWasPendingAtReloadNavigation: true,
        },
      ],
    ),
  ).toBe(false);
  expect(
    isExpectedWatchedRequestCorsError(
      "Fetch API cannot load http://localhost:45715/_agent-native/actions/get-deck-access-status due to access control checks.",
      "cleanup/navigation",
      [
        {
          url: "http://localhost:45715/_agent-native/actions/get-deck-access-status",
          pathname: "/_agent-native/actions/get-deck-access-status",
          method: "GET",
          ageMs: 100,
          requestWasPendingAtNavigation: true,
        },
      ],
    ),
  ).toBe(false);
});

it("ignores the browser-session poll warning only for a canceled cleanup claim", () => {
  const candidate = {
    url: "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim",
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };
  const warning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";

  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [candidate]),
  ).toBe(true);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      { ...candidate, sameOrigin: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      { ...candidate, competingClaimStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      { ...candidate, requestWasPendingAtNavigation: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      { ...candidate, ageMs: 9_000 },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      candidate,
      { ...candidate, ageMs: 200 },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError(warning, [
      {
        ...candidate,
        pathname: "/_agent-native/browser-sessions/session-id/requests/other",
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionPollConsoleError("another poll error", [
      candidate,
    ]),
  ).toBe(false);
});

it("ignores browser-session poll or heartbeat errors only for matching canceled reload requests", () => {
  const claimCandidate = {
    url: "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim",
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 8_999,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };
  const registrationCandidate = {
    url: "http://localhost:45715/_agent-native/browser-sessions",
    pathname: "/_agent-native/browser-sessions",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };
  const pollWarning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const heartbeatWarning =
    "[Agent-Native browser session] heartbeat failed: TypeError: Load failed";

  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, settledAgeMs: 13 },
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, sameOrigin: false, settledAgeMs: 13 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      {
        ...claimCandidate,
        requestFinishedSuccessfully: true,
        settledAgeMs: 13,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      {
        ...claimCandidate,
        requestFinishedSuccessfully: true,
        sameOrigin: true,
        responseStatus: 200,
        settledAgeMs: 13,
      },
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      {
        ...claimCandidate,
        requestFinishedSuccessfully: true,
        responseStatus: 503,
        settledAgeMs: 13,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      heartbeatWarning,
      "save/reload",
      [registrationCandidate],
    ),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      pollWarning,
      "cleanup/navigation",
      [claimCandidate],
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "step 79", [
      claimCandidate,
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, requestWasPendingAtNavigation: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, requestStartedDuringNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, competingClaimStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, ageMs: 9_000 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, settledAgeMs: 1_000 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      claimCandidate,
      { ...claimCandidate, ageMs: 200 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, ageMs: -1 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...claimCandidate, method: "GET" },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      {
        ...claimCandidate,
        pathname: "/_agent-native/browser-sessions/session-id/requests/other",
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      "another poll error",
      "save/reload",
      [claimCandidate],
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      heartbeatWarning,
      "save/reload",
      [claimCandidate],
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      heartbeatWarning,
      "save/reload",
      [{ ...registrationCandidate, requestWasPendingAtNavigation: false }],
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      heartbeatWarning,
      "save/reload",
      [{ ...registrationCandidate, ageMs: 9_000 }],
    ),
  ).toBe(false);
});

it("matches only outgoing browser-session requests canceled by the slide reload", () => {
  const sessionId = "retired-session-id";
  const claimPath =
    "/_agent-native/browser-sessions/retired-session-id/requests/claim";
  const claimAbort = {
    activePhase: "save/reload",
    method: "POST",
    pathname: claimPath,
    errorText: "NS_BINDING_ABORTED",
    sameOrigin: true,
    resourceType: "fetch",
    requestSourceIsMainFrame: true,
    requestFrameUrl: "http://localhost:34123/deck/slide-1#editing",
    outgoingDocumentUrl: "http://localhost:34123/deck/slide-1",
    requestStartedAt: 103,
    mainFrameNavigationStartedAt: 100,
    requestSequence: 12,
    mainFrameNavigationRequestSequence: 11,
    requestStartedBeforeMainFrameCommit: true,
    requestFailedAt: 118,
    requestKind: "poll" as const,
    requestSessionId: sessionId,
    retiredSessionId: sessionId,
    competingSameTypeRequest: false,
  };

  expect(isExpectedOutgoingBrowserSessionNavigationAbort(claimAbort)).toBe(
    true,
  );
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      requestSessionId: "new-session-id",
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      requestSourceIsMainFrame: false,
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      requestFrameUrl: "http://localhost:34123/deck/slide-2",
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      resourceType: "xhr",
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      requestSequence: 11,
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      requestStartedBeforeMainFrameCommit: false,
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      competingSameTypeRequest: true,
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      errorText: "NS_ERROR_NET_TIMEOUT",
    }),
  ).toBe(false);
  expect(
    isExpectedOutgoingBrowserSessionNavigationAbort({
      ...claimAbort,
      mainFrameNavigationStartedAt: null,
    }),
  ).toBe(false);

  const registrationBody = JSON.stringify({
    session: { id: sessionId },
    sessionId,
  });
  expect(
    browserSessionNavigationRequestIdentity(
      "POST",
      "/_agent-native/browser-sessions",
      registrationBody,
    ),
  ).toEqual({ status: "identified", kind: "heartbeat", sessionId });
  expect(
    browserSessionNavigationRequestIdentity(
      "POST",
      "/_agent-native/browser-sessions",
      JSON.stringify({ session: { id: "other" }, sessionId }),
    ),
  ).toEqual({ status: "invalid", reason: "malformed-registration" });
  expect(
    browserSessionNavigationRequestIdentity(
      "POST",
      "/_agent-native/browser-sessions",
      "not-json",
    ),
  ).toEqual({ status: "invalid", reason: "malformed-registration" });

  const heartbeatAbort = {
    ...claimAbort,
    pathname: "/_agent-native/browser-sessions",
    requestKind: "heartbeat" as const,
  };
  expect(isExpectedOutgoingBrowserSessionNavigationAbort(heartbeatAbort)).toBe(
    true,
  );

  const pollWarning =
    "[Agent-Native browser session] poll failed: TypeError: NetworkError when attempting to fetch resource.";
  const heartbeatWarning =
    "[Agent-Native browser session] heartbeat failed: TypeError: NetworkError when attempting to fetch resource.";
  const failedClaim = {
    url: "http://localhost/_agent-native/browser-sessions/retired-session-id/requests/claim",
    pathname:
      "/_agent-native/browser-sessions/retired-session-id/requests/claim",
    method: "POST",
    ageMs: 18,
    outgoingNavigationAbort: true,
    outgoingRequestKind: "poll" as const,
    requestSessionId: sessionId,
    retiredSessionId: sessionId,
    outgoingAbortWarningAgeMs: 150,
    competingSameTypeRequest: false,
  };
  const failedRegistration = {
    ...failedClaim,
    outgoingRequestKind: "heartbeat" as const,
  };
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      failedClaim,
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(
      heartbeatWarning,
      "save/reload",
      [failedRegistration],
    ),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...failedClaim, outgoingAbortWarningAgeMs: 251 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      { ...failedClaim, competingSameTypeRequest: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(pollWarning, "save/reload", [
      failedClaim,
      failedClaim,
    ]),
  ).toBe(false);
});

it("correlates Firefox reload warnings whether request failure arrives first or second", async () => {
  vi.useFakeTimers();
  try {
    const warning =
      "[Agent-Native browser session] poll failed: TypeError: NetworkError when attempting to fetch resource.";
    const failedClaim = {
      url: "http://localhost/_agent-native/browser-sessions/retired-session-id/requests/claim",
      pathname:
        "/_agent-native/browser-sessions/retired-session-id/requests/claim",
      method: "POST",
      ageMs: 18,
      outgoingNavigationAbort: true,
      outgoingRequestKind: "poll" as const,
      requestSessionId: "retired-session-id",
      retiredSessionId: "retired-session-id",
      outgoingAbortWarningAgeMs: 150,
      competingSameTypeRequest: false,
    };
    let candidates: (typeof failedClaim)[] = [];

    const warningFirst =
      isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace(
        warning,
        "save/reload",
        () => candidates,
      );
    setTimeout(() => {
      candidates = [failedClaim];
    }, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(await warningFirst).toBe(true);

    candidates = [failedClaim];
    const failureFirst =
      isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace(
        warning,
        "save/reload",
        () => candidates,
      );
    await vi.advanceTimersByTimeAsync(250);
    expect(await failureFirst).toBe(true);

    candidates = [];
    const unmatchedWarning =
      isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace(
        warning,
        "save/reload",
        () => candidates,
      );
    await vi.advanceTimersByTimeAsync(250);
    expect(await unmatchedWarning).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("correlates WebKit's retired browser-session claim error to the reload window", () => {
  const origin = "http://localhost:65362";
  const sessionId = "4ffee127-e336-48bf-b3e8-e9ca9f5640e8";
  const navigationStartedAt = 1_000;
  const error = `Fetch API cannot load ${origin}/_agent-native/browser-sessions/${sessionId}/requests/claim due to access control checks.`;
  const pollWarning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";

  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "save/reload",
      sessionId,
      origin,
      navigationStartedAt,
      1_017,
      false,
    ),
  ).toBe(true);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "save/reload",
      "another-session",
      origin,
      navigationStartedAt,
      1_017,
      false,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error.replace(origin, "http://other.localhost:65362"),
      "save/reload",
      sessionId,
      origin,
      navigationStartedAt,
      1_017,
      false,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error.replace(`${origin}/_agent-native`, "http://[invalid/_agent-native"),
      "save/reload",
      sessionId,
      origin,
      navigationStartedAt,
      1_017,
      false,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "step 17",
      sessionId,
      origin,
      navigationStartedAt,
      1_017,
      false,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "save/reload",
      sessionId,
      origin,
      null,
      1_017,
      false,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "save/reload",
      sessionId,
      origin,
      navigationStartedAt,
      1_017,
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionCorsError(
      error,
      "save/reload",
      sessionId,
      origin,
      navigationStartedAt,
      2_000,
      false,
    ),
  ).toBe(false);

  expect(
    isExpectedSaveReloadRetiredBrowserSessionPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      1_024,
    ),
  ).toBe(true);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      1_268,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionPollWarning(
      pollWarning,
      "step 17",
      1_017,
      1_024,
    ),
  ).toBe(false);
  expect(
    isExpectedSaveReloadRetiredBrowserSessionPollWarning(
      "another poll failure",
      "save/reload",
      1_017,
      1_024,
    ),
  ).toBe(false);
});

it("seeds browser session tracking only from one unambiguous pending claim", () => {
  const claim = (sessionId: string) => ({
    method: "POST",
    pathname: `/_agent-native/browser-sessions/${sessionId}/requests/claim`,
  });

  expect(uniquePendingBrowserSessionId([claim("session-a")])).toBe("session-a");
  expect(
    uniquePendingBrowserSessionId([claim("session-a"), claim("session-a")]),
  ).toBe("session-a");
  expect(
    uniquePendingBrowserSessionId([claim("session-a"), claim("session-b")]),
  ).toBe(null);
  expect(
    uniquePendingBrowserSessionId([{ ...claim("session-a"), method: "GET" }]),
  ).toBe(null);
});

it("updates the tracked session for claims during reload navigation", () => {
  expect(
    browserSessionIdAfterRequest(
      "retired-session",
      "POST",
      "/_agent-native/browser-sessions/new-session/requests/claim",
    ),
  ).toBe("new-session");
  expect(
    browserSessionIdAfterRequest(
      "retired-session",
      "POST",
      "/_agent-native/browser-sessions",
    ),
  ).toBe("retired-session");
});

it("recognizes claim and registration traffic that starts after navigation", () => {
  expect(
    isPostNavigationBrowserSessionTraffic(
      "/_agent-native/browser-sessions/new-session/requests/claim",
      true,
      false,
    ),
  ).toBe(true);
  expect(
    isPostNavigationBrowserSessionTraffic(
      "/_agent-native/browser-sessions",
      false,
      true,
    ),
  ).toBe(true);
  expect(
    isPostNavigationBrowserSessionTraffic(
      "/_agent-native/actions/get-deck",
      true,
      false,
    ),
  ).toBe(false);
});

it("distinguishes outgoing retired-session traffic from a competing new session", () => {
  const outgoingRequest = {
    pathname: "/_agent-native/browser-sessions/retired-session/requests/claim",
    requestStartedDuringNavigation: true,
    requestStartedAfterNavigation: false,
    requestSourceIsMainFrame: true,
    requestFrameUrl: "http://localhost:34123/deck/slide-1#editing",
    outgoingDocumentUrl: "http://localhost:34123/deck/slide-1",
    requestSessionId: "retired-session",
    retiredSessionId: "retired-session",
  };

  expect(isCompetingRetiredBrowserSessionTraffic(outgoingRequest)).toBe(false);
  expect(
    isCompetingRetiredBrowserSessionTraffic({
      ...outgoingRequest,
      pathname: "/_agent-native/browser-sessions/new-session/requests/claim",
      requestSessionId: "new-session",
    }),
  ).toBe(true);
  expect(
    isCompetingRetiredBrowserSessionTraffic({
      ...outgoingRequest,
      requestSessionId: null,
    }),
  ).toBe(true);
  expect(
    isCompetingRetiredBrowserSessionTraffic({
      ...outgoingRequest,
      requestStartedDuringNavigation: false,
      requestStartedAfterNavigation: true,
    }),
  ).toBe(true);
  expect(
    isCompetingRetiredBrowserSessionTraffic({
      ...outgoingRequest,
      requestSourceIsMainFrame: false,
    }),
  ).toBe(true);
});

it("does not let a completed same-kind request block abort correlation", () => {
  const request = {
    outgoingRequestKind: "poll" as const,
    requestSourceIsMainFrame: true,
    requestFrameUrl: "http://localhost:34123/deck/slide-1#editing",
    finishedSuccessfully: false,
    mainFrameNavigationRequestSequence: 10,
    mainFrameNavigationStartedAt: 100,
    requestSequence: 8,
    requestStartedBeforeMainFrameCommit: false,
  };
  const outgoingDocumentUrl = "http://localhost:34123/deck/slide-1";

  expect(
    isCompetingOutgoingBrowserSessionRequest(
      "poll",
      outgoingDocumentUrl,
      request,
    ),
  ).toBe(true);
  expect(
    isCompetingOutgoingBrowserSessionRequest("poll", outgoingDocumentUrl, {
      ...request,
      finishedSuccessfully: true,
    }),
  ).toBe(false);
  expect(
    isCompetingOutgoingBrowserSessionRequest(
      "heartbeat",
      outgoingDocumentUrl,
      request,
    ),
  ).toBe(false);
  expect(
    isCompetingOutgoingBrowserSessionRequest("poll", outgoingDocumentUrl, {
      ...request,
      requestSequence: 12,
      requestStartedBeforeMainFrameCommit: false,
    }),
  ).toBe(false);
  expect(
    isCompetingOutgoingBrowserSessionRequest("poll", outgoingDocumentUrl, {
      ...request,
      requestSequence: 12,
      requestStartedBeforeMainFrameCommit: true,
    }),
  ).toBe(true);
});

it("finalizes a deferred outgoing request before cleanup can discard it", () => {
  const candidate = {
    failureAt: 120,
    failureText: "NS_BINDING_ABORTED",
    outgoingNavigationAbort: false,
    pendingOutgoingAbort: true,
  };

  expect(
    finalizeDeferredOutgoingBrowserSessionAbort(candidate, (at, errorText) => {
      expect(at).toBe(120);
      expect(errorText).toBe("NS_BINDING_ABORTED");
      return false;
    }),
  ).toBe("unexpected");
  expect(candidate).toMatchObject({
    outgoingNavigationAbort: false,
    pendingOutgoingAbort: false,
  });
  expect(
    finalizeDeferredOutgoingBrowserSessionAbort(candidate, () => false),
  ).toBe("not-pending");
});

it("pairs retired-session reload errors in either event order and retains late errors", () => {
  const origin = "http://localhost:65362";
  const sessionId = "4ffee127-e336-48bf-b3e8-e9ca9f5640e8";
  const pageError = `Fetch API cannot load ${origin}/_agent-native/browser-sessions/${sessionId}/requests/claim due to access control checks.`;
  const pollWarning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const makeCorrelator = () => {
    const correlator = createRetiredBrowserSessionErrorCorrelator();
    correlator.beginNavigation(sessionId, origin, 1_000);
    return correlator;
  };

  const pageErrorFirst = makeCorrelator();
  expect(pageErrorFirst.finishNavigation(1_010)).toBe(990);
  expect(
    pageErrorFirst.onPageError(pageError, "save/reload", 1_017, false),
  ).toEqual({ matched: true, errors: [] });
  expect(
    pageErrorFirst.onPollWarning(
      pollWarning,
      "save/reload",
      1_024,
      sessionId,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(pageErrorFirst.nextExpiryDelay(1_024)).toBe(null);
  expect(pageErrorFirst.clear()).toEqual([]);

  const pollWarningFirst = makeCorrelator();
  expect(
    pollWarningFirst.onPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      sessionId,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(
    pollWarningFirst.onPageError(pageError, "save/reload", 1_024, false),
  ).toEqual({ matched: true, errors: [] });
  expect(pollWarningFirst.nextExpiryDelay(1_024)).toBe(null);

  const pollWarningAfterNavigationGrace = makeCorrelator();
  expect(
    pollWarningAfterNavigationGrace.onPageError(
      pageError,
      "save/reload",
      1_990,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(
    pollWarningAfterNavigationGrace.onPollWarning(
      pollWarning,
      "save/reload",
      2_010,
      sessionId,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(pollWarningAfterNavigationGrace.nextExpiryDelay(2_010)).toBe(null);

  const pollWarningBeforeNavigationCutoff = makeCorrelator();
  expect(
    pollWarningBeforeNavigationCutoff.onPollWarning(
      pollWarning,
      "save/reload",
      1_990,
      sessionId,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(
    pollWarningBeforeNavigationCutoff.onPageError(
      pageError,
      "save/reload",
      2_010,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(pollWarningBeforeNavigationCutoff.nextExpiryDelay(2_010)).toBe(null);

  const unpairedLatePageError = makeCorrelator();
  expect(
    unpairedLatePageError.onPageError(pageError, "save/reload", 2_010, false),
  ).toEqual({ matched: false, errors: [] });
  expect(unpairedLatePageError.nextExpiryDelay(2_010)).toBe(null);

  const newSessionWarning = makeCorrelator();
  expect(
    newSessionWarning.onPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      "new-session",
      false,
    ),
  ).toEqual({ matched: false, errors: [] });
  expect(
    newSessionWarning.onPageError(pageError, "save/reload", 1_024, false),
  ).toEqual({ matched: true, errors: [] });
  expect(newSessionWarning.flushExpired(1_275)).toEqual([pageError]);

  const pageErrorWithoutPoll = makeCorrelator();
  expect(
    pageErrorWithoutPoll.onPageError(pageError, "save/reload", 1_017, false),
  ).toEqual({ matched: true, errors: [] });
  expect(pageErrorWithoutPoll.flushExpired(1_268)).toEqual([pageError]);

  const pollWarningWithoutPageError = makeCorrelator();
  expect(
    pollWarningWithoutPageError.onPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      sessionId,
      false,
    ),
  ).toEqual({ matched: true, errors: [] });
  expect(pollWarningWithoutPageError.flushExpired(1_268)).toEqual([
    pollWarning,
  ]);

  const latePageError = makeCorrelator();
  latePageError.finishNavigation(1_010);
  expect(
    latePageError.onPageError(pageError, "save/reload", 2_000, false),
  ).toEqual({ matched: false, errors: [] });
});

it("keeps retired-session errors visible when post-navigation traffic starts", () => {
  const origin = "http://localhost:65362";
  const sessionId = "4ffee127-e336-48bf-b3e8-e9ca9f5640e8";
  const pageError = `Fetch API cannot load ${origin}/_agent-native/browser-sessions/${sessionId}/requests/claim due to access control checks.`;
  const pollWarning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const makeCorrelator = () => {
    const correlator = createRetiredBrowserSessionErrorCorrelator();
    correlator.beginNavigation(sessionId, origin, 1_000);
    return correlator;
  };

  const pageErrorFirst = makeCorrelator();
  expect(
    pageErrorFirst.onPageError(pageError, "save/reload", 1_017, true),
  ).toEqual({ matched: false, errors: [] });
  expect(
    pageErrorFirst.onPollWarning(
      pollWarning,
      "save/reload",
      1_024,
      sessionId,
      true,
    ),
  ).toEqual({ matched: false, errors: [] });

  const pollWarningFirst = makeCorrelator();
  expect(
    pollWarningFirst.onPollWarning(
      pollWarning,
      "save/reload",
      1_017,
      sessionId,
      true,
    ),
  ).toEqual({ matched: false, errors: [] });
  expect(
    pollWarningFirst.onPageError(pageError, "save/reload", 1_024, true),
  ).toEqual({ matched: false, errors: [] });
});

it("correlates a poll error to one successful claim that finished just before reload", () => {
  const warning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const completedClaim = {
    url: "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim",
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 120,
    settledAgeMs: 12,
    sameOrigin: true,
    responseStatus: 200,
    requestWasPendingAtNavigation: false,
    requestFinishedSuccessfully: true,
    completedSuccessfullyBeforeNavigation: true,
    completedBeforeNavigationAgeMs: 4,
    requestStartedDuringNavigation: false,
    requestStartedAfterNavigation: false,
  };

  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      completedClaim,
    ]),
  ).toBe(true);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, responseStatus: 500 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, sameOrigin: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, completedBeforeNavigationAgeMs: 250 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, settledAgeMs: 1_000 },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, competingClaimStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      completedClaim,
      { ...completedClaim, url: `${completedClaim.url}?second` },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      completedClaim,
      {
        ...completedClaim,
        ageMs: 9_000,
        requestWasPendingAtNavigation: true,
        requestFinishedSuccessfully: false,
        completedSuccessfullyBeforeNavigation: false,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      { ...completedClaim, method: "GET" },
    ]),
  ).toBe(false);
});

it("keeps poll errors visible when a new claim starts after reload navigation", () => {
  const warning =
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const completedClaim = {
    url: "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim",
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 120,
    settledAgeMs: 12,
    sameOrigin: true,
    responseStatus: 200,
    requestWasPendingAtNavigation: false,
    requestFinishedSuccessfully: true,
    completedSuccessfullyBeforeNavigation: true,
    completedBeforeNavigationAgeMs: 4,
    requestStartedDuringNavigation: false,
    requestStartedAfterNavigation: false,
    competingClaimStartedAfterNavigation: true,
  };
  const postNavigationClaim = {
    ...completedClaim,
    ageMs: 150,
    settledAgeMs: 4,
    requestWasPendingAtNavigation: false,
    requestFinishedSuccessfully: false,
    completedSuccessfullyBeforeNavigation: false,
    requestStartedAfterNavigation: true,
    competingClaimStartedAfterNavigation: false,
  };

  expect(
    isExpectedSaveReloadBrowserSessionConsoleError(warning, "save/reload", [
      completedClaim,
      postNavigationClaim,
    ]),
  ).toBe(false);
});

it("normalizes only Firefox browser-session errors with the expected console arguments", async () => {
  const makeMessage = (prefix: unknown, error: unknown, args = 2) => ({
    text: () => "[Agent-Native browser session] poll failed: JSHandle@object",
    args: () =>
      Array.from({ length: args }, (_, index) => ({
        jsonValue: async () => (index === 0 ? prefix : undefined),
        evaluate: async <T>(pageFunction: (value: unknown) => T) =>
          pageFunction(error),
      })),
  });

  expect(
    isFirefoxBrowserSessionConsoleError(
      "[Agent-Native browser session] heartbeat failed: JSHandle@object",
    ),
  ).toBe(true);
  expect(
    isFirefoxBrowserSessionConsoleError(
      "[Agent-Native browser session] poll failed: TypeError: Load failed",
    ),
  ).toBe(false);
  expect(
    await normalizeFirefoxBrowserSessionConsoleError(
      makeMessage(
        "[Agent-Native browser session] poll failed:",
        "TypeError: Load failed",
      ),
    ),
  ).toBe("[Agent-Native browser session] poll failed: TypeError: Load failed");
  expect(
    await normalizeFirefoxBrowserSessionConsoleError({
      text: () =>
        "[Agent-Native browser session] heartbeat failed: JSHandle@object",
      args: () => [
        {
          jsonValue: async () =>
            "[Agent-Native browser session] heartbeat failed:",
          evaluate: async <T>(pageFunction: (value: unknown) => T) =>
            pageFunction(new TypeError("Load failed")),
        },
        {
          jsonValue: async () => undefined,
          evaluate: async <T>(pageFunction: (value: unknown) => T) =>
            pageFunction(new TypeError("Load failed")),
        },
      ],
    }),
  ).toBe(
    "[Agent-Native browser session] heartbeat failed: TypeError: Load failed",
  );
  expect(
    await normalizeFirefoxBrowserSessionConsoleError(
      makeMessage(
        "[Agent-Native browser session] poll failed:",
        "TypeError: unrelated failure",
      ),
    ),
  ).toBe(
    "[Agent-Native browser session] poll failed: TypeError: unrelated failure",
  );
  expect(
    await normalizeFirefoxBrowserSessionConsoleError(
      makeMessage("some other console prefix", "TypeError: Load failed"),
    ),
  ).toBe("[Agent-Native browser session] poll failed: JSHandle@object");
  expect(
    await normalizeFirefoxBrowserSessionConsoleError(
      makeMessage(
        "[Agent-Native browser session] poll failed:",
        "TypeError: Load failed",
        1,
      ),
    ),
  ).toBe("[Agent-Native browser session] poll failed: JSHandle@object");
});

it("accepts cleanup request cancellations while navigation errors are delivered", () => {
  const candidate = {
    url: "http://localhost:45715/_agent-native/browser-sessions/session-id/requests/claim",
    pathname: "/_agent-native/browser-sessions/session-id/requests/claim",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };
  const message = `Fetch API cannot load ${candidate.url} due to access control checks.`;

  // WebKit may report the aborted fetch after page.goto has already resolved.
  expect(isExpectedCleanupNavigationError(message, [candidate], true)).toBe(
    true,
  );
  expect(
    isExpectedCleanupNavigationError(
      "[Agent-Native browser session] poll failed: TypeError: Load failed",
      [candidate],
      true,
    ),
  ).toBe(true);
  expect(isExpectedCleanupNavigationError(message, [candidate], false)).toBe(
    false,
  );
  expect(
    isExpectedCleanupNavigationError(
      message,
      [{ ...candidate, requestWasPendingAtNavigation: false }],
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedCleanupNavigationError(
      message,
      [{ ...candidate, ageMs: 9_000 }],
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedCleanupNavigationError(
      message,
      [{ ...candidate, method: "GET" }],
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedCleanupNavigationError(
      message,
      [candidate, { ...candidate, ageMs: 200 }],
      true,
    ),
  ).toBe(false);
  expect(
    isExpectedCleanupNavigationError(
      message,
      [{ ...candidate, competingRequestStartedAfterNavigation: true }],
      true,
    ),
  ).toBe(false);
});

it("ignores cleanup heartbeat failures only for a matching canceled registration", () => {
  const candidate = {
    url: "http://localhost:45715/_agent-native/browser-sessions",
    pathname: "/_agent-native/browser-sessions",
    method: "POST",
    ageMs: 100,
    sameOrigin: true,
    requestWasPendingAtNavigation: true,
  };
  const warning =
    "[Agent-Native browser session] heartbeat failed: TypeError: Load failed";

  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [candidate]),
  ).toBe(true);
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [
      { ...candidate, sameOrigin: false },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [
      { ...candidate, competingRegistrationStartedAfterNavigation: true },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [
      { ...candidate, requestFinishedSuccessfully: true },
    ]),
  ).toBe(false);
  expect(isExpectedCleanupNavigationError(warning, [candidate], true)).toBe(
    true,
  );
  expect(isExpectedCleanupNavigationError(warning, [candidate], false)).toBe(
    false,
  );
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [
      { ...candidate, method: "GET" },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(warning, [
      { ...candidate, ageMs: 9_000 },
    ]),
  ).toBe(false);
  expect(
    isExpectedCleanupBrowserSessionHeartbeatConsoleError(
      "[Agent-Native browser session] heartbeat failed: TypeError: unrelated failure",
      [candidate],
    ),
  ).toBe(false);
});

it("does not hide aged browser-session registration CORS errors", () => {
  const url = "http://localhost:45715/_agent-native/browser-sessions";
  const message = `Fetch API cannot load ${url} due to access control checks.`;
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        url,
        pathname: "/_agent-native/browser-sessions",
        method: "POST",
        ageMs: 9_000,
        requestWasPendingAtReloadNavigation: true,
      },
    ]),
  ).toBe(false);
  expect(
    isExpectedSaveReloadWatchedRequestCorsConsoleError(message, "save/reload", [
      {
        url,
        pathname: "/_agent-native/browser-sessions",
        method: "POST",
        ageMs: 10_000,
        requestWasPendingAtReloadNavigation: true,
      },
    ]),
  ).toBe(false);
});

it("keeps a prior authoring regression's failure exit when a later seed cannot run", () => {
  expect(authoringFuzzUnavailableExitCode(0)).toBe(2);
  expect(authoringFuzzUnavailableExitCode(1)).toBe(1);
});

it("maps absolute seeds to stable synthetic and committed layout profiles", () => {
  expect([0, 1, 3, 5, 7, 9, 11, 13].map(authoringFuzzProfileIndex)).toEqual(
    Array(8).fill(null),
  );
  expect([2, 4, 6, 8, 10, 12, 14].map(authoringFuzzProfileIndex)).toEqual([
    0, 1, 2, 3, 4, 5, 0,
  ]);
  expect(() => authoringFuzzProfileIndex(-1)).toThrow(
    "non-negative safe integer",
  );
});

it("requires the scaled profile to render below 0.99 after viewport setup", async () => {
  await expect(
    assertSlideIsScaled(pageAtScale(0.98), "#scaled-slide"),
  ).resolves.toBeUndefined();
  await expect(
    assertSlideIsScaled(pageAtScale(0.99), "#scaled-slide"),
  ).rejects.toThrow("scaled fixture did not scale below 0.99");
  await expect(
    assertSlideIsScaled(pageAtScale(1), "#scaled-slide"),
  ).rejects.toThrow("scale 1.000");
  await expect(
    assertSlideIsScaled(pageAtScale(0), "#scaled-slide"),
  ).rejects.toThrow("scale 0.000");
});

it("checks the rendered slide scale when the scaled profile is requested", async () => {
  const page = {
    url: () => "http://localhost:5173/",
    on: () => {},
    off: () => {},
    evaluate: async () => {},
    locator: (selector: string) =>
      selector === "#editor"
        ? { waitFor: async () => {} }
        : {
            evaluate: async (readScale: (element: HTMLElement) => number) =>
              readScale({
                offsetWidth: 100,
                getBoundingClientRect: () => ({ width: 100 }),
              } as HTMLElement),
          },
  };

  await expect(
    runAuthoringFuzz(page, {
      seed: 42,
      steps: 1,
      editorSelector: "#editor",
      slideSelector: "#slide",
      slideContentSelector: "#slide-content",
      originalHtml: "",
      originalSlideHtml: "",
      finishAndReload: async () => ({
        originalHtml: "",
        liveHtml: "",
        savedHtml: "",
        reloadedHtml: "",
      }),
      modifier: "Meta",
      expectScaledSlide: true,
    }),
  ).rejects.toThrow("scaled fixture did not scale below 0.99 (scale 1.000)");
});

it("prints a bounded failure excerpt with a deterministic seed and replay step count", () => {
  const plan = createAuthoringFuzzPlan(42, 500);
  const failure = formatAuthoringFuzzFailure(
    42,
    "step 499",
    plan,
    "caret left the editor",
    "firefox",
  );
  const logHeader = failure.message.indexOf("Failure log:");
  const jsonStart = failure.message.indexOf("\n", logHeader) + 1;
  const excerpt = JSON.parse(failure.message.slice(jsonStart)) as Array<{
    step: number;
    operation: unknown;
  }>;

  expect(failure.message).toContain("--authoring-fuzz --seed 42 --steps 500");
  expect(failure.message).toContain("--browser firefox");
  expect(failure.message).toContain(
    "Failure log: steps 480-499 of 500 replay steps",
  );
  expect(excerpt).toHaveLength(20);
  expect(excerpt[0]?.step).toBe(480);
  expect(excerpt.at(-1)?.step).toBe(499);
  expect(excerpt.at(-1)?.operation).toEqual(plan.at(-1));
});
