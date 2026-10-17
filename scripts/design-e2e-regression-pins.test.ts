import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESIGN_E2E_REGRESSION_PINS,
  DESIGN_E2E_REGRESSION_SHARDS,
  findDesignE2ERegressionPinCoverageViolations,
  findDesignE2ESuppressionCallSites,
  findDesignE2ETestRegistrations,
  findDesignE2ETestLine,
  parseDesignE2ERegressionPins,
  resolveDesignE2ERegressionPin,
  resolveDesignE2ERegressionPinsForShard,
} from "./design-e2e-regression-pins.ts";
import {
  loadBasePins,
  loadBasePinExceptions,
  resolveDesignE2ECoverageBase,
} from "./guard-design-e2e-regression-pins.ts";

const REQUIRED_CORE_COVERAGE = [
  {
    shard: "inspector-2",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard repeat paste moves relative roots 16px under an RTL containing block",
  },
  {
    shard: "inspector-2",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste preserves relative roots without an anchor across screens",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title: "Keyboard repeat paste preserves mixed positioned and flow roots",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste and replacement measure the active breakpoint preview",
  },
  {
    shard: "position-1b",
    file: "select-layer-context-menu.spec.ts",
    title:
      "Select layer on a non-active overview screen preserves exact screen and layer identity",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Keyboard paste preserves non-pixel margins at exact visual coordinates",
  },
  {
    shard: "position-3",
    file: "canvas-chords.spec.ts",
    title: "Keyboard paste and replacement preserve board-layer geometry",
  },
  {
    shard: "drag-1a",
    file: "interaction-selection.spec.ts",
    title: "cmd+click deep-selects Kid B directly with no prior selection",
  },
  {
    shard: "drag-1b",
    file: "interaction-selection.spec.ts",
    title:
      "shift+click adds an unselected object, then removes it on a second shift+click",
  },
  {
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title: "a marquee over Card selects Card only, not its children",
  },
  {
    shard: "drag-2b",
    file: "interaction-selection.spec.ts",
    title: "clicking a child inside Card selects Card, not Kid A",
  },
  {
    shard: "inspector-3b",
    file: "interaction-selection.spec.ts",
    title: "double-click after selecting Card drills into the clicked child",
  },
  {
    shard: "inspector-3a",
    file: "text-tool-board-creation.spec.ts",
    title:
      "single-screen control: text tool click then immediate typing still works",
  },
  {
    shard: "inspector-4a",
    file: "text-edit-roundtrip.spec.ts",
    title:
      "inline text edit commits, undo and redo restore exact content, and reload keeps it",
  },
  {
    shard: "inspector-4b",
    file: "text-range-visibility.spec.ts",
    title: "Line Height Enter returns a real Text-tool range to the editor",
  },
  {
    shard: "position-2b",
    file: "canvas-tools.spec.ts",
    title:
      "new empty text is one atomic undo step and cancel leaves the frame intact",
  },
  {
    shard: "inspector-1a",
    file: "ai-source-continuity.spec.ts",
    title:
      "Layers-first editing preserves identity in the AI-generated Orbit source",
  },
  {
    shard: "inspector-1b",
    file: "ai-source-continuity.spec.ts",
    title:
      "duplicate authored IDs are repaired before Layers-first edits and persist after reload",
  },
  {
    shard: "inspector-3a",
    file: "ai-source-continuity.spec.ts",
    title:
      "edit-design rejects malformed AI CSS without changing the styled canvas",
  },
  {
    shard: "drag-1a",
    file: "ai-source-continuity.spec.ts",
    title:
      "dropping a layer from AI-generated source into a panel keeps its node ID and its drop position",
  },
  {
    shard: "drag-1b",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "round-trips a styled nested layer across independent designs, route remounts, and browser tabs as one undo step",
  },
  {
    shard: "drag-2b",
    file: "editor-keyboard-layers.spec.ts",
    title: "keeps two responsive pastes distinct across settled undo and redo",
  },
  {
    shard: "position-1a",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "pastes a nested selected layer on the same screen and another screen with fresh ids after reload",
  },
  {
    shard: "position-1b",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "pastes a multi-selection across screens with each layer and child id regenerated",
  },
  {
    shard: "position-2a",
    file: "editor-keyboard-layers.spec.ts",
    title:
      "duplicates, deletes, cuts, undoes, and redoes selected layers from the keyboard",
  },
  {
    shard: "inspector-3b",
    file: "editor.spec.ts",
    title:
      "deeply nested layer rows keep a clickable hit target without scrolling the tree sideways",
  },
  {
    shard: "drag-2a",
    file: "interaction-selection.spec.ts",
    title: "cmd+marquee over Card reaches into Kid A and Kid B",
  },
  {
    shard: "inspector-4a",
    file: "text-keyboard-workflow.spec.ts",
    title:
      "Cmd+Enter commits a text edit so Cmd+D duplicates the layer, and each copy keeps its own text and name",
  },
  {
    shard: "inspector-4b",
    file: "interaction-unique-paths.spec.ts",
    title:
      "paste properties copies the source's fill, border, radius and opacity onto the target and keeps the target's position and size",
  },
  {
    shard: "position-2b",
    file: "auto-layout-keyboard.spec.ts",
    title:
      "pasting into a selected frame puts one copy of Alpha inside it at Alpha's size",
  },
  {
    shard: "position-3",
    file: "paste-svg-into-selected-frame.spec.ts",
    title:
      "Cmd+V of SVG markup while a frame is selected appends the SVG as the frame's topmost child, drawn above its siblings, and selects it",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R drops the replacement where the old layer stood",
  },
  {
    shard: "inspector-4a",
    file: "canvas-chords.spec.ts",
    title:
      "clicking an inline child on the board surface selects it and leaves its text alone",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R on an underlined text layer does not nest a copy inside it",
  },
  {
    shard: "inspector-1b",
    file: "pasted-svg-image-inspector.spec.ts",
    title:
      "pasted SVG is an editable sized layer and image scale mode writes object-fit",
  },
  {
    shard: "drag-1a",
    file: "drag-and-drop.drop-containers-modifier-collisions-marquee.spec.ts",
    title: "dragging from empty canvas marquee-selects the elements it covers",
  },
  {
    shard: "drag-2b",
    file: "performance-bridge-baseline.spec.ts",
    title:
      "a Cmd-marquee across a large screen and a small one scans each crossed screen once and commits the selection once",
  },
  {
    shard: "inspector-4b",
    file: "structure-selection.spec.ts",
    title:
      "Cmd+Shift+G ungroups: the children return to the page at their original positions and stay selected together",
  },
  {
    shard: "inspector-3b",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R replaces a flow text root at its measured origin",
  },
  {
    shard: "inspector-1a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R uses rendered flow offsets for relative text",
  },
  {
    shard: "inspector-3a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R maps flow placement through rotated and skewed ancestors",
  },
  {
    shard: "inspector-4a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R places a zero-size flow text root at its measured origin",
  },
  {
    shard: "inspector-1b",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R places a stylesheet-sized transformed copy at the target bounds",
  },
  {
    shard: "drag-1b",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R replaces wrapped inline text at its measured origin",
  },
  {
    shard: "position-1a",
    file: "canvas-chords.spec.ts",
    title:
      "Cmd+Shift+R preserves a top-only transform origin on the copied layer",
  },
  {
    shard: "position-2a",
    file: "canvas-chords.spec.ts",
    title: "Cmd+Shift+R places a margin-offset copy at the target bounds",
  },
] as const;

test("required core Design interaction coverage has explicit regression pins", () => {
  for (const required of REQUIRED_CORE_COVERAGE) {
    const pin = DESIGN_E2E_REGRESSION_PINS.find(
      (candidate) =>
        candidate.file === required.file && candidate.title === required.title,
    );
    assert.equal(
      pin?.shard,
      required.shard,
      `${required.file}: ${required.title} must stay pinned to ${required.shard}`,
    );
    assert.match(
      resolveDesignE2ERegressionPin(required),
      new RegExp(`^e2e/${required.file.replaceAll(".", "\\.")}:\\d+$`),
    );
  }
});

test("regression pins resolve unique test titles to the current source lines", () => {
  assert.equal(DESIGN_E2E_REGRESSION_PINS.length, 86);
  assert.deepEqual(
    [...new Set(DESIGN_E2E_REGRESSION_PINS.map(({ shard }) => shard))],
    DESIGN_E2E_REGRESSION_SHARDS,
  );

  const resolved = DESIGN_E2E_REGRESSION_SHARDS.flatMap((shard) =>
    resolveDesignE2ERegressionPinsForShard(shard),
  );
  assert.equal(resolved.length, DESIGN_E2E_REGRESSION_PINS.length);
  assert.equal(new Set(resolved).size, resolved.length);
});

test("protected regression pins cannot be removed silently", () => {
  const basePins = [
    {
      shard: "inspector-1a",
      file: "protected.spec.ts",
      title: "protected behavior",
    },
  ];

  assert.match(
    findDesignE2ERegressionPinCoverageViolations(basePins, []).join("\n"),
    /removed without an explicit exception/,
  );
  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations(
      basePins,
      [],
      [
        {
          action: "remove",
          from: { file: "protected.spec.ts", title: "protected behavior" },
          reason: "The protected flow is covered by a replacement contract.",
          evidence: "issue-123",
        },
      ],
    ),
    [],
  );
});

test("protected regression pins require an explicit receipt to change shards", () => {
  const basePin = {
    shard: "inspector-1a",
    file: "protected.spec.ts",
    title: "protected behavior",
  } as const;
  const headPin = { ...basePin, shard: "inspector-1b" } as const;
  const receipt = {
    action: "lane-move" as const,
    from: { shard: basePin.shard, file: basePin.file, title: basePin.title },
    to: { shard: headPin.shard, file: headPin.file, title: headPin.title },
    reason: "The test moved to the shard that owns this inspector area.",
    evidence: "issue-456",
    owner: "design-infra",
  };

  assert.match(
    findDesignE2ERegressionPinCoverageViolations([basePin], [headPin]).join(
      "\n",
    ),
    /changed shards without an explicit lane-move receipt/,
  );
  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations(
      [basePin],
      [headPin],
      [receipt],
    ),
    [],
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [basePin],
      [headPin],
      [{ ...receipt, owner: "  " }],
    ).join("\n"),
    /incomplete Design E2E pin exception metadata/,
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [basePin],
      [headPin],
      [
        {
          ...receipt,
          to: { ...receipt.to, title: "different behavior" },
        },
      ],
    ).join("\n"),
    /lane-move must map the same pin/,
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [basePin],
      [headPin],
      [receipt],
      [receipt],
    ).join("\n"),
    /changed shards without an explicit lane-move receipt/,
  );
});

test("unchanged historical pin receipts remain inert after merge", () => {
  const removed = {
    action: "remove",
    from: { file: "removed.spec.ts", title: "retired behavior" },
    reason: "The behavior was intentionally retired.",
    evidence: "issue-234",
  } as const;
  const renamed = {
    action: "rename",
    from: { file: "before.spec.ts", title: "old behavior" },
    to: { file: "after.spec.ts", title: "renamed behavior" },
    reason: "The identity was clarified.",
    evidence: "issue-345",
  } as const;

  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations([], [], [removed], [removed]),
    [],
  );
  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations(
      [
        {
          shard: "inspector-1a",
          file: "after.spec.ts",
          title: "renamed behavior",
        },
      ],
      [
        {
          shard: "inspector-1a",
          file: "after.spec.ts",
          title: "renamed behavior",
        },
      ],
      [renamed],
      [renamed],
    ),
    [],
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [
        {
          shard: "inspector-1a",
          file: "removed.spec.ts",
          title: "retired behavior",
        },
      ],
      [],
      [removed],
      [removed],
    ).join("\n"),
    /removed without an explicit exception/,
  );
});

test("an explicit file and title mapping preserves a renamed pin identity", () => {
  const basePins = [
    {
      shard: "inspector-1a",
      file: "before.spec.ts",
      title: "old behavior title",
    },
  ];
  const headPins = [
    {
      shard: "inspector-1a",
      file: "after.spec.ts",
      title: "clarified behavior title",
    },
  ];

  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations(basePins, headPins, [
      {
        action: "rename",
        from: { file: "before.spec.ts", title: "old behavior title" },
        to: { file: "after.spec.ts", title: "clarified behavior title" },
        reason: "The test title and file were clarified.",
        evidence: "issue-123",
      },
    ]),
    [],
  );
});

test("pin rename receipts cannot also change the shard", () => {
  const source = {
    shard: "inspector-1a",
    file: "before.spec.ts",
    title: "old behavior",
  } as const;
  const target = {
    shard: "inspector-1a",
    file: "after.spec.ts",
    title: "renamed behavior",
  } as const;
  const receipt = {
    action: "rename" as const,
    from: { file: source.file, title: source.title },
    to: { file: target.file, title: target.title },
    reason: "The test identity was clarified.",
    evidence: "issue-567",
  };

  assert.deepEqual(
    findDesignE2ERegressionPinCoverageViolations([source], [target], [receipt]),
    [],
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [source],
      [{ ...target, shard: "inspector-1b" }],
      [receipt],
    ).join("\n"),
    /rename cannot also change shards/,
  );
});

test("pin renames cannot collapse into existing or shared identities", () => {
  const first = {
    shard: "inspector-1a",
    file: "before-a.spec.ts",
    title: "first behavior",
  };
  const second = {
    shard: "inspector-1a",
    file: "before-b.spec.ts",
    title: "second behavior",
  };
  const target = {
    shard: "inspector-1a",
    file: "after.spec.ts",
    title: "preserved behavior",
  };
  const rename = (from: typeof first) => ({
    action: "rename" as const,
    from: { file: from.file, title: from.title },
    to: { file: target.file, title: target.title },
    reason: "The test identity was renamed.",
    evidence: "issue-234",
  });

  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [first, target],
      [target],
      [rename(first)],
    ).join("\n"),
    /rename target already exists in the base/,
  );
  assert.match(
    findDesignE2ERegressionPinCoverageViolations(
      [first, second],
      [target],
      [rename(first), rename(second)],
    ).join("\n"),
    /multiple Design E2E pin renames target the same identity/,
  );
});

test("a moved test title resolves to its new line", () => {
  const pin = {
    shard: "fixture",
    file: "fixture.spec.ts",
    title: "the pinned behavior",
  } as const;
  const source = [
    'import { test } from "@playwright/test";',
    'test("another behavior", async () => {});',
    'test("the pinned behavior", async () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, pin.title), 3);
  assert.equal(
    resolveDesignE2ERegressionPin(pin, {
      readSource: () => source,
    }),
    "e2e/fixture.spec.ts:3",
  );
});

test("only Playwright and Design rails imports contribute test aliases", () => {
  const unrelatedNamed = [
    'import { test } from "unrelated-runner";',
    'test("pinned behavior", () => {});',
  ].join("\n");
  const unrelatedNamespace = [
    'import * as yjs from "yjs";',
    'yjs.test("pinned behavior", () => {});',
  ].join("\n");
  const unrelatedDefaultRailsLike = [
    'import test from "unrelated-runner/rails";',
    'test("pinned behavior", () => {});',
  ].join("\n");
  const nodeTestFixture = [
    'import test from "node:test";',
    'test("ordinary node test", () => {});',
  ].join("\n");

  for (const source of [
    unrelatedNamed,
    unrelatedNamespace,
    unrelatedDefaultRailsLike,
    nodeTestFixture,
  ]) {
    assert.deepEqual(findDesignE2ETestRegistrations(source), [], source);
  }

  const railsFixture = [
    'import { test as railsTest } from "./rails";',
    'railsTest("pinned behavior", () => {});',
  ].join("\n");
  const railsTypeScriptFixture = [
    'import { test as railsTest } from "./rails.ts";',
    'railsTest("pinned behavior", () => {});',
  ].join("\n");
  const playwrightNamed = [
    'import { test } from "@playwright/test";',
    'test("pinned behavior", () => {});',
  ].join("\n");
  const playwrightNamespace = [
    'import * as playwright from "@playwright/test";',
    'playwright.test("pinned behavior", () => {});',
  ].join("\n");
  assert.equal(findDesignE2ETestLine(railsFixture, "pinned behavior"), 2);
  assert.equal(
    findDesignE2ETestLine(railsTypeScriptFixture, "pinned behavior"),
    2,
  );
  assert.equal(findDesignE2ETestLine(playwrightNamed, "pinned behavior"), 2);
  assert.equal(
    findDesignE2ETestLine(playwrightNamespace, "pinned behavior"),
    2,
  );

  const unrelatedImportDoesNotMaskValidRailsTest = [
    'import { test } from "unrelated-runner";',
    'import { test as railsTest } from "./rails";',
    'test("lookalike", () => {});',
    'railsTest("pinned behavior", () => {});',
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(
      unrelatedImportDoesNotMaskValidRailsTest,
      "pinned behavior",
    ),
    4,
  );

  const unrelatedAliasLeavesGlobalFallbackAvailable = [
    'import { test as unrelatedTest } from "unrelated-runner";',
    'unrelatedTest("lookalike", () => {});',
    'test("global fallback", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(
      unrelatedAliasLeavesGlobalFallbackAvailable,
    ).map(({ title }) => title),
    ["global fallback"],
  );

  for (const source of [
    [
      'import { test as runnerTest } from "unrelated-runner";',
      'runnerTest.skip(true, "hidden");',
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import test from "unrelated-runner";',
      'test.skip(true, "hidden");',
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import * as runner from "unrelated-runner";',
      'runner.test.fixme(true, "hidden");',
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import { test as runnerTest } from "unrelated-runner";',
      'runnerTest[modifier](true, "hidden");',
      'test("pinned behavior", () => {});',
    ].join("\n"),
  ]) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      source,
    );
  }

  for (const source of [
    [
      'import test from "node:test";',
      'import { test as railsTest } from "./rails";',
      'test.skip(true, "ordinary node skip");',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import test from "node:test";',
      'import { test as railsTest } from "./rails";',
      'test.only("ordinary node only", () => {});',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import { test } from "node:test";',
      'import { test as railsTest } from "./rails";',
      'test.skip(true, "ordinary node skip");',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import { test } from "node:test";',
      'import { test as railsTest } from "./rails";',
      'test.only("ordinary node only", () => {});',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import * as nodeTest from "node:test";',
      'import { test as railsTest } from "./rails";',
      'nodeTest.test.skip(true, "ordinary node skip");',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
    [
      'import * as nodeTest from "node:test";',
      'import { test as railsTest } from "./rails";',
      'nodeTest.test.only("ordinary node only", () => {});',
      'railsTest("pinned behavior", () => {});',
    ].join("\n"),
  ]) {
    assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 4, source);
  }

  const lexicalShadowDoesNotReplaceTheValidImport = [
    'import { test } from "@playwright/test";',
    "function registerLocally(test: (title: string, callback: () => void) => void) {",
    '  test("shadowed lookalike", () => {});',
    "}",
    'test("valid imported test", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(
      lexicalShadowDoesNotReplaceTheValidImport,
    ).map(({ title }) => title),
    ["valid imported test"],
  );
});

test("static CommonJS test aliases preserve Playwright and node:test origins", () => {
  const source = [
    'const { test: nodeTest } = require("node:test");',
    'nodeTest.skip(true, "ordinary node skip");',
    'const { test: pw } = require("@playwright/test");',
    'pw("pinned behavior", () => {});',
    'pw("runtime suppression", () => { pw.fixme(true, "disabled"); });',
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source, "fixture.cjs");

  assert.deepEqual(
    registrations.map(({ title, line }) => [title, line]),
    [
      ["pinned behavior", 4],
      ["runtime suppression", 5],
    ],
  );
  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 4);
  assert.throws(
    () => findDesignE2ETestLine(source, "runtime suppression"),
    /must run without/,
  );
  assert.deepEqual(
    findDesignE2ESuppressionCallSites(source, "fixture.cjs").map(
      ({ modifier, line }) => [modifier, line],
    ),
    [["fixme", 5]],
  );

  const namespaceAlias = [
    'const playwright = require("@playwright/test");',
    'playwright.test("namespace behavior", () => {});',
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(namespaceAlias, "fixture.cjs")[0]?.title,
    "namespace behavior",
  );

  const unknownSource = [
    'const { test: runnerTest } = require("unrelated-runner");',
    'runnerTest.fixme(true, "unknown source");',
    'test("pinned behavior", () => {});',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(unknownSource, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );
  assert.throws(
    () => findDesignE2ESuppressionCallSites(unknownSource, "fixture.cjs"),
    /unsupported dynamic Playwright test modifier callsite/,
  );
});

test("TypeScript import-equals and awaited dynamic imports preserve test origins", () => {
  const importEquals = [
    'import playwright = require("@playwright/test");',
    'playwright.test("import-equals behavior", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(importEquals, "fixture.ts").map(
      ({ title }) => title,
    ),
    ["import-equals behavior"],
  );

  const awaitedDynamicImport = [
    'const { test: pw } = await import("@playwright/test");',
    'pw("awaited dynamic import behavior", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(awaitedDynamicImport, "fixture.mts").map(
      ({ title }) => title,
    ),
    ["awaited dynamic import behavior"],
  );

  const unknownImportEquals = [
    "import runner = require(process.env.TEST_MODULE);",
    'runner.test("unknown import-equals behavior", () => {});',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestRegistrations(unknownImportEquals, "fixture.ts"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const unknownAwaitedDynamicImport = [
    "const { test: pw } = await import(process.env.TEST_MODULE);",
    'pw("unknown awaited import behavior", () => {});',
  ].join("\n");
  assert.throws(
    () =>
      findDesignE2ETestRegistrations(
        unknownAwaitedDynamicImport,
        "fixture.mts",
      ),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );
});

test("dynamic CommonJS test roots fail closed for registrations and suppression callsites", () => {
  const sources = [
    [
      "dynamic destructured require",
      [
        "const { test: pw } = require(process.env.TEST_MODULE);",
        'pw.fixme("dynamic test source", () => {});',
      ].join("\n"),
    ],
    [
      "conditional CommonJS module root",
      [
        '(flag ? require("@playwright/test") : require(other)).test.fixme("conditional test source", () => {});',
      ].join("\n"),
    ],
  ] as const;

  const testRegistrations = [
    [
      "dynamic destructured require",
      [
        "const { test: pw } = require(process.env.TEST_MODULE);",
        'pw("dynamic test registration", () => {});',
      ].join("\n"),
    ],
    [
      "conditional CommonJS module root",
      [
        '(flag ? require("@playwright/test") : require(other)).test("conditional test registration", () => {});',
      ].join("\n"),
    ],
  ] as const;

  for (const [description, source] of testRegistrations) {
    assert.throws(
      () => findDesignE2ETestRegistrations(source, "fixture.cjs"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      description,
    );
  }

  for (const [description, source] of sources) {
    assert.throws(
      () => findDesignE2ETestRegistrations(source, "fixture.cjs"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      description,
    );
    assert.throws(
      () => findDesignE2ESuppressionCallSites(source, "fixture.cjs"),
      /unsupported dynamic Playwright test modifier callsite/,
      description,
    );
  }

  const ordinaryNodeTest = [
    'const { test: nodeTest } = require("node:test");',
    'nodeTest.skip("ordinary node test", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(ordinaryNodeTest, "fixture.cjs"),
    [],
  );
  assert.deepEqual(
    findDesignE2ESuppressionCallSites(ordinaryNodeTest, "fixture.cjs"),
    [],
  );
});

test("computed Playwright modifiers resolve or fail closed", () => {
  const computedFixme = [
    'test["fi" + "xme"]("pinned behavior", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(computedFixme).map(
      ({ title, modifier, suppressionKind }) => [
        title,
        modifier ?? null,
        suppressionKind,
      ],
    ),
    [["pinned behavior", "fixme", "direct"]],
  );

  const dynamicModifier = [
    'test("pinned behavior", () => {',
    '  const modifier = "fixme";',
    '  test[modifier](true, "dynamic suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(dynamicModifier, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const computedTestInfoModifier = [
    'test("pinned behavior", () => {',
    "  const info = test.info();",
    '  info["sk" + "ip"](true, "computed TestInfo suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(computedTestInfoModifier, "pinned behavior"),
    /must run without/,
  );

  const dynamicTestInfoModifier = [
    'test("pinned behavior", (_fixtures, testInfo) => {',
    '  const modifier = "skip";',
    '  testInfo[modifier](true, "dynamic TestInfo suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(dynamicTestInfoModifier, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const dynamicTestInfoFactoryModifier = [
    'test("pinned behavior", () => {',
    '  const modifier = "skip";',
    '  test.info()[modifier](true, "dynamic factory TestInfo suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () =>
      findDesignE2ETestLine(dynamicTestInfoFactoryModifier, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const directTestInfoFactoryModifier = [
    'test("pinned behavior", () => {',
    '  test.info()["skip"](true, "factory TestInfo suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () =>
      findDesignE2ETestLine(directTestInfoFactoryModifier, "pinned behavior"),
    /must run without/,
  );

  const calledTestInfoModifier = [
    'test("pinned behavior", (_fixtures, testInfo) => {',
    '  testInfo.skip.call(testInfo, true, "called TestInfo suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(calledTestInfoModifier, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  for (const invocation of [
    'test.fixme.call(undefined, "pinned behavior", () => {});',
    'test.fixme.apply(undefined, ["pinned behavior", () => {}]);',
    'test["fi" + "xme"].call(undefined, "pinned behavior", () => {});',
    'test["fi" + "xme"].apply(undefined, ["pinned behavior", () => {}]);',
    'test.info()["skip"].call(test.info(), true, "factory call");',
    'test.info()["skip"].apply(test.info(), [true, "factory apply"]);',
  ]) {
    assert.throws(
      () => findDesignE2ETestRegistrations(invocation),
      /Unable to inspect unsupported Playwright modifier invocation/,
      invocation,
    );
  }

  const dynamicRootModifierBind = [
    'test("pinned behavior", () => {',
    '  const modifier = "skip";',
    '  test[modifier].bind(test)(true, "dynamic root bind suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(dynamicRootModifierBind, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const dynamicAliasedModifierBind = [
    'test("pinned behavior", () => {',
    '  const modifier = "skip";',
    "  const bind = test[modifier].bind;",
    '  bind(test)(true, "dynamic aliased bind suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(dynamicAliasedModifierBind, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const dynamicSuiteModifierBind = [
    'const modifier = "skip";',
    'test.describe[modifier].bind(test.describe)("suite", () => {',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(dynamicSuiteModifierBind, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  for (const invocation of [
    'test.skip.bind(test)(true, "bound suppression");',
    'test.fixme.bind(test)(true, "bound suppression");',
    'test.skip["bind"](test)(true, "computed bind suppression");',
    'test["skip"].bind(test)(true, "computed modifier suppression");',
    'test.skip.bind.call(test.skip, test)(true, "called bind suppression");',
    'test.skip.bind.apply(test.skip, [test])(true, "applied bind suppression");',
    'test.describe.skip.bind(test.describe)("suite", () => {});',
    'test.describe.fixme.bind(test.describe)("suite", () => {});',
  ]) {
    const source = [
      'test("pinned behavior", () => {',
      `  ${invocation}`,
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      invocation,
    );
  }

  for (const invocation of [
    'testInfo.skip.bind(testInfo)(true, "bound TestInfo suppression");',
    'test.info().skip.bind(test.info())(true, "bound factory suppression");',
    'testInfo.skip.bind.call(testInfo.skip, testInfo)(true, "called TestInfo bind");',
  ]) {
    const source = [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      `  ${invocation}`,
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      invocation,
    );
  }

  const storedBoundModifier = [
    'test("pinned behavior", () => {',
    "  const skip = test.skip.bind(test);",
    '  skip(true, "stored bound suppression");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(storedBoundModifier, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  for (const source of [
    [
      'test("pinned behavior", () => {',
      "  const bind = test.skip.bind;",
      '  bind(test)(true, "aliased bind suppression");',
      "});",
    ].join("\n"),
    [
      'test("pinned behavior", () => {',
      "  const bind = test.skip.bind;",
      '  bind.call(test.skip, test)(true, "called aliased bind suppression");',
      "});",
    ].join("\n"),
    [
      'test("pinned behavior", () => {',
      "  const bind = test.skip.bind;",
      "  const skip = bind(test);",
      '  skip(true, "aliased bound suppression");',
      "});",
    ].join("\n"),
  ]) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      source,
    );
  }

  for (const source of [
    [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      "  const bind = testInfo.skip.bind;",
      '  bind(testInfo)(true, "aliased TestInfo bind suppression");',
      "});",
    ].join("\n"),
    [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      "  const bind = testInfo.skip.bind;",
      '  bind.call(testInfo.skip, testInfo)(true, "called aliased TestInfo bind");',
      "});",
    ].join("\n"),
    [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      "  const bind = testInfo.skip.bind;",
      "  const skip = bind(testInfo);",
      '  skip(true, "stored aliased TestInfo bound suppression");',
      "});",
    ].join("\n"),
    [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      "  const skip = testInfo.skip.bind(testInfo);",
      '  skip(true, "stored TestInfo bound suppression");',
      "});",
    ].join("\n"),
  ]) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      source,
    );
  }

  for (const invocation of [
    'testInfo[modifier].call(testInfo, true, "dynamic TestInfo call");',
    'testInfo[modifier].apply(testInfo, [true, "dynamic TestInfo apply"]);',
  ]) {
    const source = [
      'test("pinned behavior", (_fixtures, testInfo) => {',
      '  const modifier = "skip";',
      `  ${invocation}`,
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      invocation,
    );
  }

  for (const invocation of [
    'test.info()[modifier].call(test.info(), true, "dynamic factory TestInfo call");',
    'test.info()[modifier].apply(test.info(), [true, "dynamic factory TestInfo apply"]);',
  ]) {
    const source = [
      'test("pinned behavior", () => {',
      '  const modifier = "skip";',
      `  ${invocation}`,
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect unsupported Playwright modifier invocation/,
      invocation,
    );
  }
});

test("Playwright fixture, step, info, timeout, and hook calls remain valid", () => {
  const source = [
    "test.use({});",
    "test.setTimeout(1);",
    "test.beforeEach(() => {});",
    "expect(test).toBeDefined();",
    'test("pinned behavior", async () => {',
    '  await test.step("child", () => {});',
    '  await test.step.bind(test)("bound child", () => {});',
    "  const info = test.info();",
    '  await info.attach("artifact", { body: "text", contentType: "text/plain" });',
    '  await info.attach.bind(info)("bound-artifact", { body: "text", contentType: "text/plain" });',
    '  info.outputPath("artifact.txt");',
    '  info.outputPath.bind(info)("bound-artifact.txt");',
    "});",
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 5);
});

test("title-shaped text in comments, strings, templates, and regexes is ignored", () => {
  const source = [
    '// test("the pinned behavior", () => {});',
    'const text = "test(\\"the pinned behavior\\")";',
    'const template = `test("the pinned behavior")`;',
    "const multilineTemplate = `",
    '  test("the pinned behavior", () => {});',
    "`;",
    "/*",
    'test("the pinned behavior", () => {});',
    "*/",
    'const pattern = /test\\("the pinned behavior"\\)/;',
    'const patternFromArrow = () => /test\\("the pinned behavior"\\)/;',
    'const negatedPattern = !/test\\("the pinned behavior"\\)/;',
    'test("the pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "the pinned behavior"), 13);
});

test("inline test registrations are found without matching properties or larger identifiers", () => {
  const source = [
    'fixture.test("the pinned behavior", () => {});',
    'contest("the pinned behavior", () => {});',
    'enabled && test("the pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "the pinned behavior"), 3);
});

test("a static template literal can be used as a test title", () => {
  assert.equal(
    findDesignE2ETestLine(
      "test(`the pinned behavior`, () => {});",
      "the pinned behavior",
    ),
    1,
  );
});

test("AST identities retain dynamic titles and ignore regex source after control flow", () => {
  const source = [
    'if (enabled) /test\\.fixme\\("protected behavior", \\(\\) => \\{\\}\\)/.test(sourceText);',
    'test("protected behavior", () => {});',
    "test(`parameter ${variant}`, () => {});",
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(
    source,
    "fixture.spec.ts",
  );

  assert.deepEqual(
    registrations.map(({ title, dynamic }) => ({ title, dynamic })),
    [
      { title: "protected behavior", dynamic: false },
      { title: "template:`parameter ${variant}`", dynamic: true },
    ],
  );
  assert.equal(findDesignE2ETestLine(source, "protected behavior"), 2);
});

test("constant title identifiers resolve to their immutable literal value", () => {
  const registrationFor = (title: string) =>
    findDesignE2ETestRegistrations(
      `const TITLE = ${JSON.stringify(title)};\ntest(TITLE, () => {});`,
    )[0];
  const first = registrationFor("A");
  const second = registrationFor("B");

  assert.deepEqual(
    [first?.title, first?.dynamic, second?.title, second?.dynamic],
    ["A", false, "B", false],
  );
});

test("suppressed dynamic titles require a literal for-of matrix binding", () => {
  const assertRejected = (source: string) =>
    assert.throws(
      () => findDesignE2ETestRegistrations(source),
      /Unable to inspect a dynamic title on a suppressed test registration/,
      source,
    );

  assertRejected(
    ['let TITLE = "A";', "test.fixme(TITLE, () => {});"].join("\n"),
  );
  assertRejected(
    ['const TITLE = "A" + "x";', "test.fixme(TITLE, () => {});"].join("\n"),
  );
  assertRejected(
    ['const TITLE = "A";', "test.fixme(`global ${TITLE}`, () => {});"].join(
      "\n",
    ),
  );
  assertRejected(
    [
      "const TITLE = `runtime ${suffix}`;",
      "test(TITLE, (_fixtures, testInfo) => {",
      '  testInfo.skip(true, "runtime suppression");',
      "});",
    ].join("\n"),
  );
  assertRejected(
    [
      'const TITLE = "suite";',
      'test.describe.skip("suite", () => {',
      "  test(`dynamic ${TITLE}`, () => {});",
      "});",
    ].join("\n"),
  );
  assertRejected(
    [
      'const TITLE = "file";',
      'test.skip(true, "file suppression");',
      "test(`dynamic ${TITLE}`, () => {});",
    ].join("\n"),
  );

  const registrationForTheme = (theme: string) =>
    findDesignE2ETestRegistrations(
      [
        `for (const { theme } of [{ theme: ${JSON.stringify(theme)} }] as const) {`,
        "  test.fixme(`theme ${theme}`, () => {});",
        "}",
      ].join("\n"),
    )[0];
  const dark = registrationForTheme("dark");
  const light = registrationForTheme("light");

  assert.deepEqual([dark?.dynamic, dark?.suppressionKind], [true, "direct"]);
  assert.notEqual(dark?.suppressionFingerprint, light?.suppressionFingerprint);

  const activeDynamicTitle = findDesignE2ETestRegistrations(
    'let TITLE = "A"; test(TITLE, () => {});',
  )[0];
  assert.equal(activeDynamicTitle?.dynamic, true);
  assert.equal(activeDynamicTitle?.suppressionKind, null);
});

test("base pin manifests are read as static literals without executing source", () => {
  const source = [
    'import ts from "typescript";',
    'throw new Error("historical module execution is unsafe");',
    "export const DESIGN_E2E_REGRESSION_PINS = [",
    '  { shard: "inspector-1a", file: "fixture.spec.ts", title: "protected" },',
    "] as const;",
  ].join("\n");

  assert.deepEqual(parseDesignE2ERegressionPins(source), [
    {
      shard: "inspector-1a",
      file: "fixture.spec.ts",
      title: "protected",
    },
  ]);
  assert.throws(
    () =>
      parseDesignE2ERegressionPins(
        'const titles = ["protected"]; export const DESIGN_E2E_REGRESSION_PINS = titles;',
      ),
    /array literal/,
  );
});

test("historical base pin loading parses the Git blob and never imports it", () => {
  const root = mkdtempSync(join(tmpdir(), "design-base-pin-manifest-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "scripts/design-e2e-regression-pins.ts"),
      [
        'import ts from "typescript";',
        'throw new Error("base source must not execute");',
        "export const DESIGN_E2E_REGRESSION_PINS = [",
        '  { shard: "inspector-1a", file: "fixture.spec.ts", title: "protected" },',
        "] as const;",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "scripts/design-e2e-coverage-exceptions.json"),
      JSON.stringify({
        pins: [
          {
            action: "remove",
            from: { file: "removed.spec.ts", title: "retired behavior" },
            reason: "The behavior was intentionally retired.",
            evidence: "issue-234",
          },
          {
            action: "lane-move",
            from: {
              shard: "inspector-1a",
              file: "fixture.spec.ts",
              title: "protected",
            },
            to: {
              shard: "inspector-1b",
              file: "fixture.spec.ts",
              title: "protected",
            },
            reason: "The protected flow moved to its owning inspector shard.",
            evidence: "issue-456",
            owner: "design-infra",
          },
        ],
        quarantine: [],
      }),
    );
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guard test"], { cwd: root });
    execFileSync(
      "git",
      ["config", "user.email", "guard-test@example.invalid"],
      {
        cwd: root,
      },
    );
    execFileSync(
      "git",
      [
        "add",
        "scripts/design-e2e-regression-pins.ts",
        "scripts/design-e2e-coverage-exceptions.json",
      ],
      { cwd: root },
    );
    execFileSync("git", ["commit", "-qm", "base manifest fixture"], {
      cwd: root,
    });

    assert.deepEqual(loadBasePins(root, "HEAD"), [
      {
        shard: "inspector-1a",
        file: "fixture.spec.ts",
        title: "protected",
      },
    ]);
    assert.deepEqual(loadBasePinExceptions(root, "HEAD"), [
      {
        action: "remove",
        from: { file: "removed.spec.ts", title: "retired behavior" },
        reason: "The behavior was intentionally retired.",
        evidence: "issue-234",
      },
      {
        action: "lane-move",
        from: {
          shard: "inspector-1a",
          file: "fixture.spec.ts",
          title: "protected",
        },
        to: {
          shard: "inspector-1b",
          file: "fixture.spec.ts",
          title: "protected",
        },
        reason: "The protected flow moved to its owning inspector shard.",
        evidence: "issue-456",
        owner: "design-infra",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent base exception registry is treated as an empty legacy registry", () => {
  const root = mkdtempSync(join(tmpdir(), "design-base-pin-exceptions-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guard test"], { cwd: root });
    execFileSync(
      "git",
      ["config", "user.email", "guard-test@example.invalid"],
      { cwd: root },
    );
    writeFileSync(join(root, "tracked.txt"), "legacy base\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "legacy base fixture"], {
      cwd: root,
    });

    assert.deepEqual(loadBasePinExceptions(root, "HEAD"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitHub pull request pin checks require the explicit target base", () => {
  const previous = {
    event: process.env.GITHUB_EVENT_NAME,
    githubBase: process.env.GITHUB_BASE_REF,
    guardBase: process.env.GUARD_DIFF_BASE,
  };
  const root = mkdtempSync(join(tmpdir(), "design-pin-missing-base-"));
  try {
    process.env.GITHUB_EVENT_NAME = "pull_request";
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GUARD_DIFF_BASE;
    assert.throws(
      () => resolveDesignE2ECoverageBase(root),
      (error: NodeJS.ErrnoException & { exitCode?: number }) =>
        error.exitCode === 2 && /GITHUB_BASE_REF/.test(error.message ?? ""),
    );
  } finally {
    if (previous.event === undefined) delete process.env.GITHUB_EVENT_NAME;
    else process.env.GITHUB_EVENT_NAME = previous.event;
    if (previous.githubBase === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = previous.githubBase;
    if (previous.guardBase === undefined) delete process.env.GUARD_DIFF_BASE;
    else process.env.GUARD_DIFF_BASE = previous.guardBase;
    rmSync(root, { recursive: true, force: true });
  }
});

test("the resolver CLI works with the workspace TypeScript parser", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "design-pin-resolver-"));
  try {
    const scriptsDirectory = join(temporaryRoot, "scripts");
    const specDirectory = join(temporaryRoot, "templates/design/e2e");
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(specDirectory, { recursive: true });
    symlinkSync(
      fileURLToPath(new URL("../node_modules", import.meta.url)),
      join(temporaryRoot, "node_modules"),
      "dir",
    );
    copyFileSync(
      fileURLToPath(
        new URL("./design-e2e-regression-pins.ts", import.meta.url),
      ),
      join(scriptsDirectory, "design-e2e-regression-pins.ts"),
    );
    for (const { file } of DESIGN_E2E_REGRESSION_PINS.filter(
      ({ shard }) => shard === "inspector-1a",
    )) {
      const source = new URL(
        `../templates/design/e2e/${file}`,
        import.meta.url,
      );
      assert.equal(existsSync(source), true);
      copyFileSync(fileURLToPath(source), join(specDirectory, file));
    }

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scriptsDirectory, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /e2e\/canvas-invariants\.spec\.ts:\d+\0/);
    assert.match(
      result.stdout,
      /e2e\/builder-shell-no-network\.spec\.ts:\d+\0/,
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("missing, duplicate, and unknown regression pins fail closed", () => {
  assert.throws(
    () => findDesignE2ETestLine('test("other", () => {});', "missing"),
    /must match exactly one test title/,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test("same", () => {});\ntest("same", () => {});',
        "same",
      ),
    /must match exactly one test title/,
  );
  assert.throws(
    () => resolveDesignE2ERegressionPinsForShard("unknown-shard"),
    /Unknown Design regression shard/,
  );
});

test("fixed regression pins reject skipped, expected-failure, and focused declarations", () => {
  for (const modifier of ["skip", "fixme", "fail", "only"]) {
    assert.throws(
      () =>
        findDesignE2ETestLine(
          `test.${modifier}("pinned behavior", () => {});`,
          "pinned behavior",
        ),
      /must run without test modifiers/,
    );
  }
});

test("fixed regression pins reject enclosing disabled or focused suites", () => {
  for (const modifier of ["fail", "skip", "fixme", "only"]) {
    const source = [
      'test.describe("outer suite", () => {',
      '  test.describe("nested suite", () => {',
      `    test.describe.${modifier}("inner suite", () => {`,
      '      test("pinned behavior", () => {});',
      "    });",
      "  });",
      "});",
    ].join("\n");

    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /must run without/,
      `test.describe.${modifier} must not disable a nested pin`,
    );
  }
});

test("fixed regression pins reject focused sibling tests and suites", () => {
  const siblingTestOnly = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    '  test.only("another test", () => {});',
    "});",
  ].join("\n");
  const siblingDescribeOnly = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    "});",
    'test.describe.only("focused suite", () => {',
    '  test("another test", () => {});',
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(siblingTestOnly, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(siblingDescribeOnly, "pinned behavior"),
    /must run without/,
  );
});

test("unrelated skipped suites and skipped sibling tests do not hide a pin", () => {
  const source = [
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    '  test.skip("skipped sibling", () => {});',
    '  test("runtime-skipped sibling", () => { test.skip(true, "skip sibling"); });',
    '  test("runtime-fixme sibling", () => { test.fixme(true, "fix sibling"); });',
    '  test("expected-failure sibling", () => { test.fail(true, "expected failure"); });',
    "});",
    'test.describe.skip("unrelated suite", () => {',
    '  test("another test", () => {});',
    "});",
    'test.describe("another unrelated suite", () => {',
    '  test.skip(true, "skip this suite");',
    '  test("a skipped suite test", () => {});',
    "});",
    'test("a skipped sibling", () => { test.skip(true, "skip only this test"); });',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 2);
});

test("runtime skip, fixme, and fail annotations reject a pinned test body", () => {
  for (const modifier of ["skip", "fixme", "fail"]) {
    for (const annotation of [
      `test.${modifier}(true, "runtime annotation");`,
      `test?.${modifier}(true, "optional runtime annotation");`,
      `testInfo.${modifier}(true, "TestInfo annotation");`,
      `test.info().${modifier}(true, "test.info annotation");`,
    ]) {
      assert.throws(
        () =>
          findDesignE2ETestLine(
            `test("pinned behavior", () => { ${annotation} });`,
            "pinned behavior",
          ),
        /must run without/,
        `${annotation} inside the pinned body must not mask its result`,
      );
    }
  }
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test("pinned behavior", ({ isMobile }) => { test.fixme(isMobile, "mobile unsupported"); });',
        "pinned behavior",
      ),
    /Unable to inspect conditional test\.fixme/,
  );
});

test("conditional Playwright test receivers retain suppression coverage", () => {
  const knownAlias = [
    'import { test } from "@playwright/test";',
    'test("pinned behavior", () => {',
    '  (enabled ? test : test).fixme(true, "conditional alias");',
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(knownAlias, "pinned behavior"),
    /must run without/,
  );
  assert.deepEqual(
    findDesignE2ESuppressionCallSites(knownAlias).map(({ modifier, line }) => [
      modifier,
      line,
    ]),
    [["fixme", 3]],
  );

  const ambiguousAlias = [
    'import { test } from "@playwright/test";',
    'test("pinned behavior", () => {',
    '  (enabled ? test : otherApi).fixme(true, "ambiguous alias");',
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(ambiguousAlias, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );
  assert.throws(
    () => findDesignE2ESuppressionCallSites(ambiguousAlias),
    /unsupported dynamic Playwright test modifier callsite/,
  );
});

test("runtime suppressions in nested helpers stay attached to their registered test", () => {
  for (const modifier of ["skip", "fixme"]) {
    const source = [
      `test("pinned behavior", (_fixtures, testInfo) => {`,
      `  function nestedHelper() { testInfo.${modifier}(true, "nested helper"); }`,
      "  nestedHelper();",
      "});",
    ].join("\n");

    assert.equal(
      findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
      "runtime",
      `testInfo.${modifier} in a nested helper must remain associated with the enclosing test`,
    );
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /must run without/,
    );
  }
});

test("uncalled nested helpers do not suppress their enclosing registration", () => {
  const source = [
    'test("pinned behavior", (_fixtures, testInfo) => {',
    '  function unusedSkip() { testInfo.skip(true, "not called"); }',
    '  const unusedFixme = () => testInfo.fixme(true, "also not called");',
    "});",
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.suppressionKind, null);
  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 1);
});

test("called nested helper cycles retain runtime suppressions", () => {
  const source = [
    'test("pinned behavior", (_fixtures, testInfo) => {',
    "  function cycleA() { cycleB(); }",
    '  function cycleB() { cycleA(); testInfo.skip(true, "called cycle"); }',
    "  cycleA();",
    "});",
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.suppressionKind, "runtime");
  assert.throws(
    () => findDesignE2ETestLine(source, "pinned behavior"),
    /must run without/,
  );
});

test("file and suite lifecycle hook suppressions are scoped to affected tests", () => {
  const fileHooks = [
    'test.beforeEach((_fixtures, testInfo) => testInfo.skip(true, "file beforeEach"));',
    'test.beforeAll(() => test.skip(true, "file beforeAll"));',
    'test.afterEach((_fixtures, testInfo) => testInfo.fixme(true, "file afterEach"));',
    'test.afterAll(() => test.fixme(true, "file afterAll"));',
    'test("file affected", () => {});',
  ].join("\n");
  const fileRegistrations = findDesignE2ETestRegistrations(fileHooks);

  assert.equal(fileRegistrations.length, 1);
  assert.equal(fileRegistrations[0]?.title, "file affected");
  assert.equal(fileRegistrations[0]?.suppressionKind, "file");
  const fileEvents = JSON.parse(
    fileRegistrations[0]?.suppressionFingerprint ?? "[]",
  ) as Array<{ scope: string; callee: string }>;
  assert.deepEqual(
    fileEvents
      .filter(({ scope }) => scope === "file")
      .map(({ callee }) => callee)
      .sort(),
    ["test.fixme", "test.skip", "testInfo.fixme", "testInfo.skip"],
  );

  const suiteHooks = [
    'test.describe("hooked suite", () => {',
    '  test.beforeEach((_fixtures, testInfo) => testInfo.skip(true, "suite beforeEach"));',
    '  test.beforeAll(() => test.skip(true, "suite beforeAll"));',
    '  test.afterEach((_fixtures, testInfo) => testInfo.fixme(true, "suite afterEach"));',
    '  test.afterAll(() => test.fixme(true, "suite afterAll"));',
    '  test("suite affected", () => {});',
    "});",
    'test.describe("unrelated suite", () => {',
    '  test("unrelated behavior", () => {});',
    "});",
  ].join("\n");
  const suiteRegistrations = findDesignE2ETestRegistrations(suiteHooks);
  const affected = suiteRegistrations.find(
    ({ title }) => title === "suite affected",
  );
  const unrelated = suiteRegistrations.find(
    ({ title }) => title === "unrelated behavior",
  );

  assert.equal(suiteRegistrations.length, 2);
  assert.equal(affected?.suppressionKind, "suite");
  assert.equal(unrelated?.suppressionKind, null);
  const suiteEvents = JSON.parse(
    affected?.suppressionFingerprint ?? "[]",
  ) as Array<{ scope: string; callee: string }>;
  assert.deepEqual(
    suiteEvents
      .filter(({ scope }) => scope === "suite")
      .map(({ callee }) => callee)
      .sort(),
    ["test.fixme", "test.skip", "testInfo.fixme", "testInfo.skip"],
  );
});

test("top-level helpers called by tests attach skip and fixme suppressions without recursion leaks", () => {
  const source = [
    "function enterCycleA() { enterCycleB(); }",
    "function enterCycleB() { enterCycleA(); skipMobile(); }",
    'function skipMobile() { test.skip(isMobile, "mobile helper"); }',
    'function markWebkitFixme() { test.fixme(browserName === "webkit", "webkit helper"); }',
    'function unusedSkip() { test.skip(true, "uninvoked helper"); }',
    'test("cycle skip behavior", () => { enterCycleA(); });',
    'test("helper fixme behavior", () => { markWebkitFixme(); });',
    'test("active unrelated behavior", () => {});',
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);

  assert.equal(registrations.length, 3);
  assert.deepEqual(
    registrations.map(({ title, suppressionKind }) => [title, suppressionKind]),
    [
      ["cycle skip behavior", "runtime"],
      ["helper fixme behavior", "runtime"],
      ["active unrelated behavior", null],
    ],
  );
});

test("TestInfo const aliases resolve lexically without leaking through shadows", () => {
  const source = [
    'test("aliased runtime skip", (_fixtures, testInfo) => {',
    "  const info = testInfo;",
    "  const alias = info;",
    '  alias.skip(true, "aliased metadata");',
    "});",
    'test("shadowed alias stays active", (_fixtures, testInfo) => {',
    "  const info = testInfo;",
    "  function unrelatedShadow() {",
    "    const info = {};",
    '    info.skip(true, "unrelated shadow");',
    "  }",
    "});",
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);

  assert.deepEqual(
    registrations.map(({ title, suppressionKind }) => [title, suppressionKind]),
    [
      ["aliased runtime skip", "runtime"],
      ["shadowed alias stays active", null],
    ],
  );
});

test("mutable TestInfo aliases are tracked or fail closed after reassignment", () => {
  for (const keyword of ["let", "var"]) {
    const source = [
      'test("mutable alias skip", (_fixtures, testInfo) => {',
      `  ${keyword} info = testInfo;`,
      '  info.skip(true, "mutable alias");',
      "});",
    ].join("\n");
    assert.equal(
      findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
      "runtime",
      `${keyword} aliases initialized from TestInfo remain recognized`,
    );
  }

  for (const declaration of [
    "let info; info = testInfo;",
    "let info = testInfo; info = {};",
    "let info; [info] = [testInfo];",
    "let info; ({ info } = { info: testInfo });",
  ]) {
    const source = [
      'test("ambiguous mutable alias", (_fixtures, testInfo) => {',
      `  ${declaration}`,
      '  info.skip(true, "ambiguous alias");',
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestLine(source, "ambiguous mutable alias"),
      /Unable to inspect ambiguous TestInfo alias/,
      declaration,
    );
  }

  const shadowed = [
    'test("shadowed mutable alias stays active", (_fixtures, testInfo) => {',
    "  let info = testInfo;",
    "  {",
    "    let info = {};",
    '    info.skip(true, "shadowed object");',
    "  }",
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(shadowed, "shadowed mutable alias stays active"),
    1,
  );
});

test("TestInfo authority stays visible through literal containers", () => {
  const cases = [
    [
      "array destructured TestInfo authority",
      [
        'test("array destructured TestInfo authority", async ({}, testInfo) => {',
        "  const [info] = [testInfo];",
        '  info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
    [
      "object property TestInfo authority",
      [
        'test("object property TestInfo authority", async ({}, testInfo) => {',
        "  const holder = { info: testInfo };",
        '  holder.info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
  ] as const;

  for (const [title, source] of cases) {
    const registrations = findDesignE2ETestRegistrations(source);
    assert.equal(registrations.length, 1, title);
    assert.equal(registrations[0]?.suppressionKind, "runtime", title);
    assert.throws(
      () => findDesignE2ETestLine(source, title),
      /must run without/,
    );
  }

  const reassignedContainers = [
    [
      "container property reassigned to TestInfo",
      [
        'test("pin", async ({}, testInfo) => {',
        "  const holder = { info: { skip() {} } };",
        "  holder.info = testInfo;",
        '  holder.info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
    [
      "container property reassigned to TestInfo through an alias",
      [
        'test("pin", async ({}, testInfo) => {',
        "  const holder = { info: { skip() {} } };",
        "  let alias = holder;",
        "  alias.info = testInfo;",
        '  holder.info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
  ] as const;
  for (const [title, source] of reassignedContainers) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pin"),
      /Unable to inspect ambiguous TestInfo alias/,
      title,
    );
  }

  const ordinaryApi = [
    'test("ordinary TestInfo API stays active", (_fixtures, testInfo) => {',
    '  testInfo.outputPath("artifact.txt");',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(ordinaryApi, "ordinary TestInfo API stays active"),
    1,
  );
});

test("TestInfo authority stays ambiguous when assigned by for-of loops", () => {
  const cases = [
    [
      "TestInfo loop-head assignment",
      [
        'test("pin", ({}, testInfo) => {',
        "  let info = { skip() {} };",
        "  for (info of [testInfo]) {}",
        '  info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
    [
      "TestInfo loop-head container-property assignment",
      [
        'test("pin", ({}, testInfo) => {',
        "  const holder = { info: { skip() {} } };",
        "  for (holder.info of [testInfo]) {}",
        '  holder.info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
  ] as const;

  for (const [title, source] of cases) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pin"),
      /Unable to inspect ambiguous TestInfo alias/,
      title,
    );
  }

  const ordinaryLoopVariable = [
    'test("ordinary loop variable stays active", ({}, testInfo) => {',
    "  let info = { skip() {} };",
    "  for (info of [{ skip() {} }]) {}",
    '  info.skip(true, "ordinary helper");',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(
      ordinaryLoopVariable,
      "ordinary loop variable stays active",
    ),
    1,
  );
});

test("TestInfo authority stays ambiguous through literal destructuring", () => {
  const cases = [
    [
      "TestInfo object destructuring",
      [
        'test("pin", ({}, testInfo) => {',
        "  const { info } = { info: testInfo };",
        '  info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
    [
      "TestInfo nested array-object destructuring",
      [
        'test("pin", ({}, testInfo) => {',
        "  const [{ info }] = [{ info: testInfo }];",
        '  info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
    [
      "TestInfo object for-of destructuring",
      [
        'test("pin", ({}, testInfo) => {',
        "  for (const { info } of [{ info: testInfo }]) {",
        '    info.skip(true, "hidden");',
        "  }",
        "});",
      ].join("\n"),
    ],
    [
      "TestInfo array for-of destructuring",
      [
        'test("pin", ({}, testInfo) => {',
        "  for (const [info] of [[testInfo]]) {",
        '    info.skip(true, "hidden");',
        "  }",
        "});",
      ].join("\n"),
    ],
    [
      "TestInfo assignment for-of destructuring",
      [
        'test("pin", ({}, testInfo) => {',
        "  let info;",
        "  for ({ info } of [{ info: testInfo }]) {}",
        '  info.skip(true, "hidden");',
        "});",
      ].join("\n"),
    ],
  ] as const;

  for (const [title, source] of cases) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pin"),
      /(?:must run without test modifiers or suite\/file suppression|Unable to inspect ambiguous TestInfo alias)/,
      title,
    );
  }
});

test("awaited Promise and test.step callbacks keep runtime skips on the test", () => {
  const cases = [
    [
      "then",
      'await Promise.resolve().then(() => testInfo.skip(true, "async metadata"));',
      "await Promise.resolve().then(unresolvedHandler);",
    ],
    [
      "then rejection",
      'await Promise.reject(new Error("expected")).then(undefined, () => testInfo.skip(true, "async metadata"));',
      "await Promise.resolve().then(undefined, unresolvedHandler);",
    ],
    [
      "catch",
      'await Promise.reject(new Error("expected")).catch(() => testInfo.skip(true, "async metadata"));',
      'await Promise.reject(new Error("expected")).catch(unresolvedHandler);',
    ],
    [
      "finally",
      'await Promise.resolve().finally(() => testInfo.skip(true, "async metadata"));',
      "await Promise.resolve().finally(unresolvedHandler);",
    ],
    [
      "step",
      'await test.step("child", () => testInfo.skip(true, "async metadata"));',
      'await test.step("child", unresolvedHandler);',
    ],
  ] as const;

  for (const [kind, callbackStatement, unresolvedStatement] of cases) {
    const title = `awaited ${kind} callback skip`;
    const source = [
      `test(${JSON.stringify(title)}, async (_fixtures, testInfo) => {`,
      `  ${callbackStatement}`,
      "});",
    ].join("\n");
    const registrations = findDesignE2ETestRegistrations(source);

    assert.equal(registrations.length, 1, kind);
    assert.equal(registrations[0]?.suppressionKind, "runtime", kind);
    assert.throws(
      () => findDesignE2ETestLine(source, title),
      /must run without/,
    );

    const unresolvedSource = [
      `test(${JSON.stringify(title)}, async (_fixtures, testInfo) => {`,
      `  ${unresolvedStatement}`,
      "});",
    ].join("\n");
    assert.throws(
      () => findDesignE2ETestRegistrations(unresolvedSource),
      /Unable to inspect awaited callback body/,
      kind,
    );
  }
});

test("non-awaited Promise callbacks keep runtime suppressions on the test", () => {
  for (const statement of [
    'Promise.resolve().then(() => testInfo.skip(true, "then metadata"));',
    'Promise.reject(new Error("expected")).catch(() => testInfo.fixme(true, "catch metadata"));',
    'Promise.resolve().finally(() => testInfo.skip(true, "finally metadata"));',
  ]) {
    const source = [
      'test("non-awaited callback suppression", (_fixtures, testInfo) => {',
      `  ${statement}`,
      "});",
    ].join("\n");
    assert.equal(
      findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
      "runtime",
      statement,
    );
    assert.throws(
      () => findDesignE2ETestLine(source, "non-awaited callback suppression"),
      /must run without/,
      statement,
    );
  }

  const activeSource = [
    'test("non-awaited active callback", () => {',
    "  Promise.resolve().then(() => expect(true).toBe(true));",
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(activeSource, "non-awaited active callback"),
    1,
  );
});

test("directly invoked local helper callbacks retain test context", () => {
  const source = [
    'test("helper callback suppression", (_fixtures, testInfo) => {',
    "  function invoke(callback: () => void) { callback(); }",
    '  invoke(() => testInfo.skip(true, "invoked callback"));',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
    "runtime",
  );
  assert.throws(
    () => findDesignE2ETestLine(source, "helper callback suppression"),
    /must run without/,
  );
});

test("unused helper callbacks and uncalled helpers do not suppress a test", () => {
  const source = [
    'test("unused helper callback stays active", (_fixtures, testInfo) => {',
    "  function invoke(_callback: () => void) {}",
    '  invoke(() => testInfo.skip(true, "unused callback"));',
    '  function uncalled() { testInfo.fixme(true, "uncalled helper"); }',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
    null,
  );
  assert.equal(
    findDesignE2ETestLine(source, "unused helper callback stays active"),
    1,
  );

  const omittedOptionalCallback = [
    'test("omitted optional callback stays active", () => {',
    "  function maybeRun(callback?: () => void) { callback?.(); }",
    "  maybeRun(undefined);",
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(
      omittedOptionalCallback,
      "omitted optional callback stays active",
    ),
    1,
  );

  const nullDefaultCallback = [
    'test("null default callback stays active", () => {',
    "  function maybeRun(callback: (() => void) | null = null) { callback?.(); }",
    "  maybeRun();",
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(
      nullDefaultCallback,
      "null default callback stays active",
    ),
    1,
  );

  const functionDefaultCallback = [
    'test("function default callback suppresses", (_fixtures, testInfo) => {',
    '  function maybeRun(callback: () => void = () => testInfo.skip(true, "default callback")) { callback(); }',
    "  maybeRun();",
    "});",
  ].join("\n");
  assert.throws(
    () =>
      findDesignE2ETestLine(
        functionDefaultCallback,
        "function default callback suppresses",
      ),
    /must run without/,
  );
});

test("unknown executed callbacks fail closed only when they can suppress a test", () => {
  const suppressed = [
    'test("unknown callback suppression", (_fixtures, testInfo) => {',
    '  externalRunner(() => testInfo.skip(true, "unknown callback"));',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(suppressed, "unknown callback suppression"),
    /Unable to inspect callback effects passed to externalRunner/,
  );

  const active = [
    'test("unknown callback active", () => {',
    "  externalRunner(() => expect(true).toBe(true));",
    "});",
  ].join("\n");
  assert.equal(findDesignE2ETestLine(active, "unknown callback active"), 1);

  const generated = [
    '["one"].forEach(() => test.fixme("generated callback registration", () => {}));',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(generated).map(
      ({ title, suppressionKind }) => [title, suppressionKind],
    ),
    [["generated callback registration", "direct"]],
  );

  const fileRuntimeSkip = [
    'externalRunner(() => test.skip(true, "file runtime skip"));',
    'test("file runtime target", () => {});',
  ].join("\n");
  const suiteRuntimeSkip = [
    'test.describe("suite", () => {',
    "  externalRunner(() => test.skip(isMobile, REASON));",
    '  test("suite runtime target", () => {});',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(fileRuntimeSkip, "file runtime target"),
    /Unable to inspect callback effects passed to externalRunner/,
  );
  assert.throws(
    () => findDesignE2ETestLine(suiteRuntimeSkip, "suite runtime target"),
    /Unable to inspect callback effects passed to externalRunner/,
  );
});

test("wrapped receivers and loop-head authority writes keep test aliases visible", () => {
  const wrappedCalls = [
    '(test).skip("wrapped existing", () => {});',
    '(test as any).fixme("asserted existing", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(wrappedCalls).map(
      ({ title, modifier, suppressionKind }) => [
        title,
        modifier ?? null,
        suppressionKind,
      ],
    ),
    [
      ["wrapped existing", "skip", "direct"],
      ["asserted existing", "fixme", "direct"],
    ],
  );

  for (const source of [
    [
      "let api;",
      "for (api of [test]) {}",
      'api.skip(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
    [
      "let api = test;",
      "for ([api] of [[test]]) {}",
      'api.skip(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
    [
      "let api = test;",
      'for (api in { key: "value" }) {}',
      'api.skip(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
    [
      "for (var api of [test]) {}",
      'api.skip(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
    [
      "for (const api of [test]) {",
      '  api.skip(true, "hidden");',
      "}",
      'test("pin", () => {});',
    ].join("\n"),
    [
      "for (const [api] of [[test]]) {",
      '  api.skip(true, "hidden");',
      "}",
      'test("pin", () => {});',
    ].join("\n"),
    [
      "const holder = {};",
      "for (holder.api of [test]) {}",
      'holder.api.skip(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
    [
      "const holder = {};",
      'for (holder["api"] of [test]) {}',
      'holder["api"].fixme(true, "hidden");',
      'test("pin", () => {});',
    ].join("\n"),
  ]) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pin"),
      /Unable to inspect ambiguous Playwright API alias/,
      source,
    );
  }
});

test("escaped Playwright modifiers fail closed through objects and helper parameters", () => {
  const objectAlias = [
    "const api = { skip: test.skip };",
    'api.skip("new test", () => {});',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestRegistrations(objectAlias),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  for (const source of [
    [
      "const skip = test.skip;",
      "const api = { skip };",
      'api.skip("new test", () => {});',
    ].join("\n"),
    [
      "const { skip } = { skip: test.skip };",
      'skip("new test", () => {});',
    ].join("\n"),
    [
      "const api = { ...{ skip: test.skip } };",
      'api.skip("new test", () => {});',
    ].join("\n"),
    [
      "const api = { nested: { skip: test.skip } };",
      'api.nested.skip("new test", () => {});',
    ].join("\n"),
    [
      "const api = { skip: test.skip };",
      "declare const modifierName: string;",
      'api[modifierName]("new test", () => {});',
    ].join("\n"),
    [
      "function invoke(skip: typeof test.skip) { skip(true, 'helper skip'); }",
      "invoke(test.skip);",
    ].join("\n"),
    [
      "import { suppress } from 'external-runner';",
      "suppress(test.skip);",
    ].join("\n"),
    [
      "const getSkip = () => test.skip;",
      "getSkip()(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "const getSkip = () => test.skip.bind(test);",
      "getSkip()(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "function getSkip() { return test.skip; }",
      "const skip = getSkip();",
      "skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "function suppress(api: typeof test) { api.skip(true, 'helper skip'); }",
      "suppress({ skip: test.skip });",
    ].join("\n"),
    [
      "function suppress(api = test) { api.skip(true, 'helper skip'); }",
      "suppress();",
    ].join("\n"),
    [
      "function suppress({ skip } = test) { skip(true, 'helper skip'); }",
      "suppress();",
    ].join("\n"),
    [
      "(0, test.fixme)('hidden', () => {});",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "[test.fixme][0]('hidden', () => {});",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let skip;",
      "skip = test.skip;",
      "skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let skip;",
      "({ skip } = { skip: test.skip });",
      "skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let skip;",
      "[skip] = [test.skip];",
      "skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let api;",
      "api = test;",
      "api.skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let skip;",
      "({ skip } = test);",
      "skip(true, 'helper skip');",
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "let api;",
      "api = test.describe;",
      'api.skip("hidden", () => {});',
      'test("pinned behavior", () => {});',
    ].join("\n"),
    [
      "const holder = {};",
      "holder.api = test;",
      "holder.api.skip(true, 'reason');",
      "test('pin', () => {});",
    ].join("\n"),
    [
      "const holder = {};",
      "holder.api = test.describe;",
      "holder.api.skip('hidden', () => {});",
      "test('pin', () => {});",
    ].join("\n"),
    [
      "const holder = {};",
      "[holder.api] = [test];",
      "holder.api.skip(true, 'reason');",
      "test('pin', () => {});",
    ].join("\n"),
    [
      "const holder = {};",
      "holder.api = [test];",
      "holder.api[0].skip(true, 'reason');",
      "test('pin', () => {});",
    ].join("\n"),
    [
      "const holder = {};",
      "[holder.api] = [test.describe];",
      "holder.api.skip('hidden', () => {});",
      "test('pin', () => {});",
    ].join("\n"),
  ]) {
    assert.throws(
      () => findDesignE2ETestRegistrations(source),
      /Unable to inspect unsupported Playwright modifier invocation/,
      source,
    );
  }

  const helperAlias = [
    "function suppress(api: typeof test) {",
    '  api.skip(true, "helper skip");',
    "}",
    "suppress(test);",
    'test("pinned behavior", () => {});',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(helperAlias, "pinned behavior"),
    /Unable to inspect unsupported Playwright modifier invocation/,
  );

  const shadowedHelperParameter = [
    "function inspect(api: typeof test) {",
    "  function inner(api: { skip: () => void }) { api.skip(); }",
    "  inner({ skip: () => {} });",
    "}",
    "inspect(test);",
    'test("pinned behavior", () => {});',
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(shadowedHelperParameter, "pinned behavior"),
    6,
  );

  const unrelatedObjectModifierName = [
    "const api = { skip: (value: string) => value };",
    'api.skip("ordinary method");',
    'test("pinned behavior", () => {});',
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(unrelatedObjectModifierName, "pinned behavior"),
    3,
  );
});

test("literal array forEach callbacks reject iteration-dependent titles and retain constant titles", () => {
  const generatedActive = [
    '["one"].forEach((name) => test(name, () => {}));',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestRegistrations(generatedActive),
    /registration title that depends on forEach item/,
  );

  const generatedQuarantine = [
    '["one"].forEach((name) => { test.fixme(name, () => {}); });',
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestRegistrations(generatedQuarantine),
    /registration title that depends on forEach item/,
  );

  for (const source of [
    '["one"].forEach((name) => { const title = name; test(title, () => {}); });',
    '["one"].forEach((name) => { let title; title = name; test(title, () => {}); });',
    '["one"].forEach((name) => { function titleForName() { return name; } test(titleForName(), () => {}); });',
    '["one"].forEach((name) => { function register(title) { test(title, () => {}); } register(name); });',
    '["one"].forEach((name) => test(`behavior ${name}`, () => {}));',
    '["one"].forEach((name, index) => test(String(index), () => {}));',
    '["one"].forEach((name) => test(name, (_fixtures, info) => info.skip(true, "why")));',
  ]) {
    assert.throws(
      () => findDesignE2ETestRegistrations(source),
      /registration title that depends on forEach item/,
      source,
    );
  }

  const constantTitle = findDesignE2ETestRegistrations(
    '["one"].forEach((name) => test("pinned behavior", () => {}));',
  )[0];
  assert.deepEqual(
    [constantTitle?.title, constantTitle?.dynamic],
    ["pinned behavior", false],
  );

  const constantQuarantine = findDesignE2ETestRegistrations(
    '["one"].forEach((name) => test.fixme("pinned behavior", () => {}));',
  )[0];
  assert.deepEqual(
    [
      constantQuarantine?.title,
      constantQuarantine?.modifier,
      constantQuarantine?.suppressionKind,
    ],
    ["pinned behavior", "fixme", "direct"],
  );

  assert.throws(
    () =>
      findDesignE2ETestRegistrations(
        "[1].forEach((name) => test(name, () => {}));",
      ),
    /registration title that depends on forEach item/,
  );

  assert.deepEqual(
    findDesignE2ETestRegistrations(
      '([]).forEach(() => test("pinned behavior", () => {}));',
    ),
    [],
  );

  assert.throws(
    () =>
      findDesignE2ETestRegistrations(
        '["one", "two"].forEach(() => test("pinned behavior", () => {}));',
      ),
    /Unable to inspect test effects from a multi-element array forEach callback/,
    "multiple same-title iterations must not look like one required pin",
  );

  for (const source of [
    'names.forEach(() => test("pinned behavior", () => {}));',
    'names.customForEach(() => test("pinned behavior", () => {}));',
  ]) {
    const registration = findDesignE2ETestRegistrations(source)[0];
    assert.equal(registration?.title, "pinned behavior", source);
    assert.equal(registration?.suppressionKind, "runtime", source);
    assert.match(
      registration?.suppressionReason ?? "",
      /Unable to inspect test registration in an uninvoked function body/,
      source,
    );
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /Unable to inspect test registration in an uninvoked function body/,
      source,
    );
  }
});

test("called helper registrations are counted once per call site", () => {
  const helper =
    'function registerBehavior() { test("helper behavior", () => {}); }';
  const once = [helper, "registerBehavior();"].join("\n");
  const twice = [helper, "registerBehavior();", "registerBehavior();"].join(
    "\n",
  );

  assert.deepEqual(
    findDesignE2ETestRegistrations(once).map(({ title, suppressionKind }) => [
      title,
      suppressionKind,
    ]),
    [["helper behavior", null]],
  );
  assert.deepEqual(
    findDesignE2ETestRegistrations(twice).map(({ title, suppressionKind }) => [
      title,
      suppressionKind,
    ]),
    [
      ["helper behavior", null],
      ["helper behavior", null],
    ],
  );
});

test("simple test aliases resolve through chains for direct and runtime fixme calls", () => {
  const directAlias = [
    "const firstTest = test;",
    "const secondTest = firstTest;",
    'secondTest.fixme("directly quarantined", () => {});',
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(directAlias)[0]?.suppressionKind,
    "direct",
  );

  const runtimeAlias = [
    "const firstTest = test;",
    "const secondTest = firstTest;",
    'test("pinned behavior", (_fixtures, testInfo) => {',
    '  secondTest.fixme(process.platform === "win32", "platform metadata");',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(runtimeAlias)[0]?.suppressionKind,
    "runtime",
  );
  assert.throws(
    () => findDesignE2ETestLine(runtimeAlias, "pinned behavior"),
    /Unable to inspect conditional test\.fixme/,
  );
});

test("test.extend aliases register tests without nested aliases hiding their scope", () => {
  const extended = [
    "const t = test.extend({});",
    't("extended fixture behavior", () => {});',
    't.fixme("extended quarantined behavior", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(extended).map(
      ({ title, modifier, suppressionKind }) => [
        title,
        modifier ?? null,
        suppressionKind,
      ],
    ),
    [
      ["extended fixture behavior", null, null],
      ["extended quarantined behavior", "fixme", "direct"],
    ],
  );

  const shadowed = [
    "const t = test;",
    'test.describe("outer suite", () => {',
    "  function nestedHelper() {",
    "    const t = test.describe;",
    '    t("nested suite", () => {});',
    "  }",
    '  t("outer alias remains a test", () => {});',
    "});",
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(shadowed).map(({ title }) => title),
    ["outer alias remains a test"],
  );
});

test("inline test.extend modifiers and suites stay attached to their registrations", () => {
  const inlineExtended = [
    'import { test } from "@playwright/test";',
    'test.extend({}).skip("inline skipped behavior", () => {});',
    'test.extend({}).fixme("inline fixme behavior", () => {});',
    'test.extend({}).describe("inline active suite", () => {',
    '  test("active suite behavior", () => {});',
    "});",
    'test.extend({}).describe.skip("inline skipped suite", () => {',
    '  test("inline suite hidden behavior", () => {});',
    "});",
  ].join("\n");

  assert.deepEqual(
    findDesignE2ETestRegistrations(inlineExtended).map(
      ({ title, modifier, suppressionKind }) => [
        title,
        modifier ?? null,
        suppressionKind,
      ],
    ),
    [
      ["inline skipped behavior", "skip", "direct"],
      ["inline fixme behavior", "fixme", "direct"],
      ["active suite behavior", null, null],
      ["inline suite hidden behavior", null, "suite"],
    ],
  );
  assert.throws(
    () => findDesignE2ETestLine(inlineExtended, "inline skipped behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );
  assert.throws(
    () => findDesignE2ETestLine(inlineExtended, "inline fixme behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );
  assert.throws(
    () => findDesignE2ETestLine(inlineExtended, "inline suite hidden behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );
  assert.equal(
    findDesignE2ETestLine(inlineExtended, "active suite behavior"),
    5,
  );

  const unrelatedFactory = [
    "const factory = { extend: (_fixtures: object) => ({ fixme: () => {} }) };",
    'factory.extend({}).fixme("ordinary factory lookalike", () => {});',
    'test("ordinary test remains visible", () => {});',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(unrelatedFactory).map(({ title }) => title),
    ["ordinary test remains visible"],
  );
});

test("suppression fingerprints ignore lines and callback bodies but retain conditions, metadata, and every call", () => {
  const base = [
    'test.fixme("pinned behavior", (_fixtures, testInfo) => {',
    '  testInfo.skip(process.platform === "win32", "platform skip");',
    '  testInfo.fixme(browserName === "webkit", "browser metadata");',
    "  expect(true).toBe(true);",
    "});",
  ].join("\n");
  const movedAndEditedBody = [
    "const unrelated = 1;",
    "",
    'test.fixme("pinned behavior", (_fixtures, testInfo) => {',
    '  testInfo.skip(process.platform === "win32", "platform skip");',
    '  testInfo.fixme(browserName === "webkit", "browser metadata");',
    '  expect("changed callback body").toBe("changed callback body");',
    "});",
  ].join("\n");
  const changedCondition = movedAndEditedBody.replace(
    'process.platform === "win32"',
    'process.platform === "darwin"',
  );
  const changedMetadata = movedAndEditedBody.replace(
    '"browser metadata"',
    '"new browser metadata"',
  );
  const removeSecondCall = movedAndEditedBody.replace(
    '  testInfo.fixme(browserName === "webkit", "browser metadata");\n',
    "",
  );
  const fingerprint = (source: string) =>
    findDesignE2ETestRegistrations(source)[0]?.suppressionFingerprint;

  assert.equal(fingerprint(base), fingerprint(movedAndEditedBody));
  assert.notEqual(fingerprint(base), fingerprint(changedCondition));
  assert.notEqual(fingerprint(base), fingerprint(changedMetadata));
  assert.notEqual(fingerprint(base), fingerprint(removeSecondCall));
  assert.equal(JSON.parse(fingerprint(base) ?? "[]").length, 3);
});

test("suppression fingerprints retain file, suite, and runtime events", () => {
  const source = [
    'test.skip(process.env.DISABLED === "true", "file metadata");',
    'test.describe.skip("suite", { tag: "@disabled" }, () => {',
    '  test.skip(process.env.SUITE_DISABLED === "true", "suite metadata");',
    '  test("pinned behavior", (_fixtures, testInfo) => {',
    '    testInfo.skip(process.env.TEST_DISABLED === "true", "runtime metadata");',
    "  });",
    "});",
  ].join("\n");
  const fingerprint =
    findDesignE2ETestRegistrations(source)[0]?.suppressionFingerprint;
  const scopes = (JSON.parse(fingerprint ?? "[]") as Array<{ scope: string }>)
    .map(({ scope }) => scope)
    .sort();

  assert.deepEqual(scopes, ["file", "runtime", "suite", "suite"]);
});

test("unresolved callback and uninvoked helper fingerprints use stable identities", () => {
  const unresolved = (name: string, prefix = "") =>
    findDesignE2ETestRegistrations(
      `${prefix}import { ${name} } from "./shared-callback.ts";\ntest("pinned behavior", ${name});`,
    )[0]?.suppressionFingerprint;
  const uninvoked = (name: string, prefix = "") =>
    findDesignE2ETestRegistrations(
      `${prefix}function ${name}() { test("pinned behavior", () => {}); }`,
    )[0]?.suppressionFingerprint;

  assert.equal(unresolved("sharedBody"), unresolved("sharedBody", "\n\n"));
  assert.notEqual(unresolved("sharedBody"), unresolved("differentBody"));
  assert.equal(uninvoked("unusedHelper"), uninvoked("unusedHelper", "\n\n"));
  assert.notEqual(uninvoked("unusedHelper"), uninvoked("anotherHelper"));
});

test("named test callbacks stay registered and retain runtime suppression", () => {
  const source = [
    "function sharedBody() {",
    '  test.fixme(true, "shared callback is quarantined");',
    "}",
    'test("active unrelated behavior", () => {});',
    'test("pinned behavior", sharedBody);',
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);
  const registration = registrations[1];

  assert.deepEqual(registration, {
    file: "",
    title: "pinned behavior",
    dynamic: false,
    line: 5,
    suppressionKind: "runtime",
    suppressionReason: "test.fixme suppresses this test at line 2",
    suppressionFingerprint:
      '[{"scope":"runtime","modifier":"fixme","callee":"test.fixme","arguments":["true","\\"shared callback is quarantined\\""]}]',
  });
  assert.deepEqual(registrations[0], {
    file: "",
    title: "active unrelated behavior",
    dynamic: false,
    line: 4,
    suppressionKind: null,
  });
  assert.throws(
    () => findDesignE2ETestLine(source, "pinned behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );

  const directlyQuarantined = [
    "function sharedBody() {}",
    'test.fixme("quarantined behavior", sharedBody);',
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(directlyQuarantined)[0]?.suppressionKind,
    "direct",
  );
  assert.throws(
    () => findDesignE2ETestLine(directlyQuarantined, "quarantined behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );
});

test("reassigned named callbacks fail closed instead of using a stale initializer", () => {
  const source = [
    "let body = () => {};",
    'body = () => test.skip(true, "replacement callback skip");',
    'test("pinned behavior", body);',
  ].join("\n");
  const registration = findDesignE2ETestRegistrations(source)[0];

  assert.equal(registration?.suppressionKind, "runtime");
  assert.match(registration?.suppressionReason ?? "", /Unable to inspect/);
  assert.throws(
    () => findDesignE2ETestLine(source, "pinned behavior"),
    /Unable to inspect the test callback body/,
  );
});

test("for-in and for-of writes invalidate named callback initializers", () => {
  for (const loopHead of [
    "sharedBody of [importedBody]",
    "sharedBody in { body: importedBody }",
  ]) {
    const source = [
      'import { body as importedBody } from "./helper";',
      "let sharedBody = () => {};",
      `for (${loopHead}) {}`,
      'test("pin", sharedBody);',
    ].join("\n");
    const registration = findDesignE2ETestRegistrations(source)[0];

    assert.equal(registration?.suppressionKind, "runtime", loopHead);
    assert.match(
      registration?.suppressionReason ?? "",
      /Unable to inspect/,
      loopHead,
    );
    assert.throws(
      () => findDesignE2ETestLine(source, "pin"),
      /Unable to inspect the test callback body/,
      loopHead,
    );
  }
});

test("writes to shadowed callback names do not invalidate the outer binding", () => {
  const source = [
    "const body = () => {};",
    "function helper(body: () => void) {",
    "  body = () => {};",
    "}",
    'test("pinned behavior", body);',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 5);
});

test("mutable Playwright aliases and TestInfo API origins retain suppressions", () => {
  const mutableAlias = [
    'test("pinned behavior", () => {',
    "  let api = test;",
    '  api.skip(true, "mutable API alias");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(mutableAlias, "pinned behavior"),
    /must run without/,
  );

  const reassignedAlias = [
    'test("pinned behavior", () => {',
    "  let api = test;",
    "  api = unrelatedApi;",
    '  api.skip(true, "ambiguous API alias");',
    "});",
  ].join("\n");
  assert.throws(
    () => findDesignE2ETestLine(reassignedAlias, "pinned behavior"),
    /Unable to inspect ambiguous Playwright API alias/,
  );

  const shadowedAlias = [
    "const api = test;",
    'test("shadowed API alias stays active", () => {',
    "  {",
    "    const api = {};",
    '    api.skip(true, "unrelated method");',
    "  }",
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(shadowedAlias, "shadowed API alias stays active"),
    2,
  );

  const testInfoCallAlias = [
    'test("test.info alias suppression", () => {',
    "  const info = test.info();",
    '  info.skip(true, "TestInfo alias");',
    "});",
  ].join("\n");
  const testInfoMethodAlias = [
    'test("destructured TestInfo modifier", (_fixtures, testInfo) => {',
    "  const { skip } = testInfo;",
    '  skip(true, "destructured TestInfo modifier");',
    "});",
  ].join("\n");
  const testMethodAlias = [
    'test("destructured test modifier", () => {',
    "  const { skip } = test;",
    '  skip(true, "destructured test modifier");',
    "});",
  ].join("\n");
  for (const [source, title] of [
    [testInfoCallAlias, "test.info alias suppression"],
    [testInfoMethodAlias, "destructured TestInfo modifier"],
    [testMethodAlias, "destructured test modifier"],
  ]) {
    assert.throws(
      () => findDesignE2ETestLine(source, title),
      /must run without/,
      source,
    );
  }

  const unrelatedMethodAlias = [
    'test("unrelated destructured method stays active", () => {',
    "  const { skip } = unrelatedApi;",
    '  skip(true, "not from a test API");',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestLine(
      unrelatedMethodAlias,
      "unrelated destructured method stays active",
    ),
    1,
  );
});

test("uninvoked function registrations fail closed without leaking runtime skips", () => {
  const source = [
    "function unusedHelper() {",
    '  test("pinned behavior", () => {});',
    '  test.skip(true, "unused helper skip");',
    "}",
    'test("active unrelated behavior", () => {});',
  ].join("\n");
  const registrations = findDesignE2ETestRegistrations(source);

  assert.deepEqual(registrations[0], {
    file: "",
    title: "pinned behavior",
    dynamic: false,
    line: 2,
    suppressionKind: "runtime",
    suppressionReason:
      "Unable to inspect test registration in an uninvoked function body",
    suppressionFingerprint:
      '[{"scope":"unknown","modifier":"uninspected-callback","callee":"unknown-execution-context","arguments":[],"callbackIdentity":"function:unusedHelper"}]',
  });
  assert.deepEqual(registrations[1], {
    file: "",
    title: "active unrelated behavior",
    dynamic: false,
    line: 5,
    suppressionKind: null,
  });
  assert.throws(
    () => findDesignE2ETestLine(source, "pinned behavior"),
    /Unable to inspect test registration in an uninvoked function body/,
  );

  const suiteSource = [
    'test.describe("active suite", () => {',
    "  function unusedHelper() {",
    '    test.skip(true, "unused helper skip");',
    "  }",
    '  test("active suite sibling", () => {});',
    "});",
  ].join("\n");
  assert.equal(
    findDesignE2ETestRegistrations(suiteSource)[0]?.suppressionKind,
    null,
  );
});

test("named describe callbacks preserve suite scope and fail closed when unresolved", () => {
  const activeSuite = [
    "function suiteBody() {",
    '  test("pinned behavior", () => {});',
    "}",
    'test.describe.serial("active suite", suiteBody);',
  ].join("\n");
  assert.deepEqual(findDesignE2ETestRegistrations(activeSuite)[0], {
    file: "",
    title: "pinned behavior",
    dynamic: false,
    line: 2,
    suppressionKind: null,
  });

  const skippedSuite = [
    "function suiteBody() {",
    '  test("pinned behavior", () => {});',
    "}",
    'test.describe.skip("skipped suite", suiteBody);',
  ].join("\n");
  assert.deepEqual(
    findDesignE2ETestRegistrations(skippedSuite)[0]?.suppressionKind,
    "suite",
  );
  assert.throws(
    () => findDesignE2ETestLine(skippedSuite, "pinned behavior"),
    /must run without test modifiers or suite\/file suppression/,
  );

  assert.throws(
    () =>
      findDesignE2ETestRegistrations(
        'test.describe.skip("unknown suite", buildSuite());',
      ),
    /Unable to inspect the test\.describe callback body/,
  );
});

test("unresolved named test callbacks fail closed for runtime suppression", () => {
  const source = [
    'import { sharedBody } from "./shared-callback.ts";',
    'test("pinned behavior", sharedBody);',
  ].join("\n");

  assert.deepEqual(
    findDesignE2ETestRegistrations(source)[0]?.suppressionKind,
    "runtime",
  );
  assert.throws(
    () => findDesignE2ETestLine(source, "pinned behavior"),
    /Unable to inspect the test callback body/,
  );
});

test("a shadowed local name does not resolve an imported registration callback", () => {
  const source = [
    'import { sharedBody } from "./helper";',
    "function wrapper() {",
    "  function sharedBody() {}",
    "}",
    'test("pin", sharedBody);',
  ].join("\n");
  const registration = findDesignE2ETestRegistrations(source)[0];

  assert.equal(registration?.title, "pin");
  assert.equal(registration?.suppressionKind, "runtime");
  assert.match(registration?.suppressionReason ?? "", /Unable to inspect/);
  assert.throws(
    () => findDesignE2ETestLine(source, "pin"),
    /Unable to inspect the test callback body/,
  );
});

test("an unresolved callback in a conditional fixme registration fails closed", () => {
  const source = [
    'import { importedCallback } from "./helper";',
    "const title = getTitle();",
    "test.fixme(title, importedCallback);",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestRegistrations(source),
    /Unable to inspect an ambiguous test\.fixme registration with an unresolved callback/,
  );
});

test("describe details overloads preserve enclosing and unrelated suite scope", () => {
  const nestedDetails = [
    'test.describe("outer", { tag: "@outer" }, () => {',
    '  test.describe("inner", { tag: "@inner" }, () => {',
    '    test("pinned behavior", () => {});',
    "  });",
    "});",
  ].join("\n");
  const unrelatedDetailsSuite = [
    'test.describe("other", { tag: "@other" }, () => {',
    '  test.skip(true, "skip only this suite");',
    '  test("other behavior", () => {});',
    "});",
    'test("pinned behavior", () => {});',
  ].join("\n");
  const unrelatedModifiedDetailsSuite = [
    'test.describe.skip("other", { tag: "@other" }, () => {',
    '  test.skip(true, "skip only this suite");',
    '  test("other behavior", () => {});',
    "});",
    'test("pinned behavior", () => {});',
  ].join("\n");
  const disabledDetailsSuite = [
    'test.describe.skip("disabled", { tag: "@disabled" }, () => {',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");
  const fileSkipInsideDetailsSuite = [
    'test.describe("conditional suite", { tag: "@conditional" }, () => {',
    '  test.skip(true, "skip this suite");',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");

  assert.equal(findDesignE2ETestLine(nestedDetails, "pinned behavior"), 3);
  assert.equal(
    findDesignE2ETestLine(unrelatedDetailsSuite, "pinned behavior"),
    5,
  );
  assert.equal(
    findDesignE2ETestLine(unrelatedModifiedDetailsSuite, "pinned behavior"),
    5,
  );
  assert.throws(
    () => findDesignE2ETestLine(disabledDetailsSuite, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(fileSkipInsideDetailsSuite, "pinned behavior"),
    /must run without/,
  );
});

test("suppression-like comments, strings, and templates do not affect a pin", () => {
  const source = [
    '// test.describe.skip("fake suite", () => {});',
    'const string = "test.only(\\"fake test\\", () => {});";',
    'const template = `test.describe.fixme("fake suite", () => {});`;',
    'const pattern = /test\\.skip\\(true, ".*"\\)/;',
    '/* test.describe.only("fake focused suite", () => {}); */',
    'test.describe("active suite", () => {',
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 7);
});

test("template expressions are inspected while raw text and regex braces stay masked", () => {
  const source = [
    'const label = `value ${(() => ({ text: "}", pattern: /[{}]/ }))()}`;',
    'test("pinned behavior", () => {});',
  ].join("\n");

  assert.equal(findDesignE2ETestLine(source, "pinned behavior"), 2);
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'const label = `${test.skip(true, "disable file")}`;\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /must run without/,
  );
  assert.equal(
    findDesignE2ETestLine(
      'const label = `${"test.skip(true, \\"disabled\\")"}`;\ntest("pinned behavior", () => {});',
      "pinned behavior",
    ),
    2,
  );
});

test("statically unconditional file and enclosing suite skips reject pins", () => {
  const fileSkip = [
    'test.skip(true, "the whole file is disabled");',
    'test("pinned behavior", () => {});',
  ].join("\n");
  const suiteSkip = [
    'test.describe("outer suite", () => {',
    '  test.describe("nested suite", () => {',
    '    test.skip(true, "the suite is disabled");',
    '    test("pinned behavior", () => {});',
    "  });",
    "});",
  ].join("\n");

  assert.throws(
    () => findDesignE2ETestLine(fileSkip, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () => findDesignE2ETestLine(suiteSkip, "pinned behavior"),
    /must run without/,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test.fixme(true, "the whole file is marked fixme");\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /must run without/,
  );
  assert.equal(
    findDesignE2ETestLine(
      'test.skip(false, "keep the file enabled");\ntest("pinned behavior", () => {});',
      "pinned behavior",
    ),
    2,
  );
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test.skip(process.platform === "win32", "platform skip");\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /Unable to inspect conditional test\.skip/,
  );
});

test("file and suite test.skip reason identifiers remain suppression metadata", () => {
  const fileSkip = [
    'const REASON = "file disabled";',
    "test.skip(true, REASON);",
    'test("file behavior", () => {});',
  ].join("\n");
  const fileRegistrations = findDesignE2ETestRegistrations(fileSkip);
  assert.equal(fileRegistrations.length, 1);
  assert.equal(fileRegistrations[0]?.title, "file behavior");
  assert.equal(fileRegistrations[0]?.suppressionKind, "file");
  assert.match(fileRegistrations[0]?.suppressionReason ?? "", /test\.skip/);
  assert.ok(
    (
      JSON.parse(
        fileRegistrations[0]?.suppressionFingerprint ?? "[]",
      ) as Array<{
        scope: string;
        arguments: string[];
      }>
    ).some(
      ({ scope, arguments: args }) =>
        scope === "file" && args.includes("REASON"),
    ),
  );

  const suiteSkip = [
    'const REASON = "suite disabled";',
    'test.describe("outer suite", () => {',
    "  test.skip(true, REASON);",
    '  test("suite behavior", () => {});',
    "});",
  ].join("\n");
  const suiteRegistrations = findDesignE2ETestRegistrations(suiteSkip);
  assert.equal(suiteRegistrations.length, 1);
  assert.equal(suiteRegistrations[0]?.title, "suite behavior");
  assert.equal(suiteRegistrations[0]?.suppressionKind, "suite");
  assert.match(suiteRegistrations[0]?.suppressionReason ?? "", /test\.skip/);
  assert.ok(
    (
      JSON.parse(
        suiteRegistrations[0]?.suppressionFingerprint ?? "[]",
      ) as Array<{
        scope: string;
        arguments: string[];
      }>
    ).some(
      ({ scope, arguments: args }) =>
        scope === "suite" && args.includes("REASON"),
    ),
  );
});

test("unknown file and suite skip conditions fail closed instead of leaving active pins", () => {
  const fileSkip = [
    'const REASON = "file disabled";',
    "test.skip(isMobile, REASON);",
    'test("pinned behavior", () => {});',
  ].join("\n");
  const suiteSkip = [
    'const REASON = "suite disabled";',
    'test.describe("outer suite", () => {',
    "  test.skip(isMobile, REASON);",
    '  test("pinned behavior", () => {});',
    "});",
  ].join("\n");

  for (const source of [fileSkip, suiteSkip]) {
    assert.throws(
      () => findDesignE2ETestLine(source, "pinned behavior"),
      /must run without|Unable to inspect conditional test\.skip/,
    );
  }
});

test("string-leading skip conditions fail closed", () => {
  assert.throws(
    () =>
      findDesignE2ETestLine(
        'test.skip("x" === "x", "disable suite");\ntest("pinned behavior", () => {});',
        "pinned behavior",
      ),
    /Unable to inspect conditional test\.skip/,
  );
});

test("modifier text inside an ordinary pinned title does not disable it", () => {
  assert.equal(
    findDesignE2ETestLine(
      'test("test.skip in a title", () => {});',
      "test.skip in a title",
    ),
    1,
  );
});

test("the resolver CLI distinguishes disabled pins from unreadable sources", () => {
  const root = mkdtempSync(join(tmpdir(), "design-disabled-pin-"));
  try {
    const scripts = join(root, "scripts");
    const specs = join(root, "templates/design/e2e");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(specs, { recursive: true });
    symlinkSync(
      fileURLToPath(new URL("../node_modules", import.meta.url)),
      join(root, "node_modules"),
      "dir",
    );
    copyFileSync(
      fileURLToPath(
        new URL("./design-e2e-regression-pins.ts", import.meta.url),
      ),
      join(scripts, "design-e2e-regression-pins.ts"),
    );
    const pins = DESIGN_E2E_REGRESSION_PINS.filter(
      ({ shard }) => shard === "inspector-1a",
    );
    const firstPinFile = join(specs, pins[0]!.file);
    const firstFilePins = pins.filter(({ file }) => file === pins[0]!.file);
    for (const file of new Set(pins.map((pin) => pin.file))) {
      writeFileSync(
        join(specs, file),
        pins
          .filter((pin) => pin.file === file)
          .map(
            (pin) =>
              `test${pin === pins[0] ? ".skip" : ""}(${JSON.stringify(pin.title)}, () => {});`,
          )
          .join("\n"),
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /must run without test modifiers/);
    assert.equal(result.stdout, "");

    writeFileSync(
      firstPinFile,
      [
        ...firstFilePins.map(
          (pin) => `test(${JSON.stringify(pin.title)}, () => {});`,
        ),
        'test.only("another test", () => {});',
      ].join("\n"),
    );
    const focused = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(focused.status, 1, focused.stderr);
    assert.match(focused.stderr, /test\.only/);
    assert.equal(focused.stdout, "");

    writeFileSync(
      firstPinFile,
      [
        'test.skip(process.platform === "win32", "conditional file skip");',
        ...firstFilePins.map(
          (pin) => `test(${JSON.stringify(pin.title)}, () => {});`,
        ),
      ].join("\n"),
    );
    const conditional = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(conditional.status, 2, conditional.stderr);
    assert.match(
      conditional.stderr,
      /Unable to inspect conditional test\.skip/,
    );
    assert.equal(conditional.stdout, "");

    rmSync(firstPinFile);
    const unavailable = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        realpathSync(join(scripts, "design-e2e-regression-pins.ts")),
        "inspector-1a",
      ],
      { encoding: "utf8" },
    );
    assert.equal(unavailable.status, 2, unavailable.stderr);
    assert.match(unavailable.stderr, /ENOENT/);
    assert.equal(unavailable.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
