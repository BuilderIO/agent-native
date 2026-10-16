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
