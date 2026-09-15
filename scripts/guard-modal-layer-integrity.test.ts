import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkLayerSingleton,
  checkOverlayPositionOverrides,
  checkTemplateStyleSources,
  findDuplicateLayerResolutions,
  findOverlayPositionOverrides,
  STYLE_SOURCE_CONTRACTS,
} from "./guard-modal-layer-integrity.ts";

function fixture(build: (root: string) => void): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "modal-layer-guard-"));
  build(root);
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeTemplate(
  root: string,
  name: string,
  { css, source }: { css: string; source: string },
) {
  mkdirSync(join(root, "templates", name, "app", "components"), {
    recursive: true,
  });
  writeFileSync(join(root, "templates", name, "app", "global.css"), css);
  writeFileSync(
    join(root, "templates", name, "app", "components", "View.tsx"),
    source,
  );
}

const RENDERS_DISPATCH = `
import { SimpleAgentsPanel } from "@agent-native/dispatch/components";
export const View = () => <SimpleAgentsPanel />;
`;

test("flags a template that renders dispatch components without its stylesheet", () => {
  const { root, cleanup } = fixture((dir) => {
    writeTemplate(dir, "factory", {
      css: '@import "tailwindcss";\n@source "./**/*.{ts,tsx}";\n',
      source: RENDERS_DISPATCH,
    });
  });
  try {
    const result = checkTemplateStyleSources(root, STYLE_SOURCE_CONTRACTS);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!, /templates\/factory renders/);
    assert.match(result.errors[0]!, /dispatch\.css/);
  } finally {
    cleanup();
  }
});

test("accepts a template that imports the dispatch stylesheet", () => {
  const { root, cleanup } = fixture((dir) => {
    writeTemplate(dir, "factory", {
      css: '@import "tailwindcss";\n@import "@agent-native/dispatch/styles/dispatch.css";\n',
      source: RENDERS_DISPATCH,
    });
  });
  try {
    const result = checkTemplateStyleSources(root, STYLE_SOURCE_CONTRACTS);
    assert.deepEqual(result.errors, []);
    assert.equal(result.checked, 1);
  } finally {
    cleanup();
  }
});

test("ignores a template that does not render the package", () => {
  const { root, cleanup } = fixture((dir) => {
    writeTemplate(dir, "forms", {
      css: '@import "tailwindcss";\n',
      source: "export const View = () => null;\n",
    });
  });
  try {
    const result = checkTemplateStyleSources(root, STYLE_SOURCE_CONTRACTS);
    assert.deepEqual(result.errors, []);
    assert.equal(result.checked, 0);
  } finally {
    cleanup();
  }
});

test("flags a caller that merges a position utility over the pinned overlay", () => {
  // The shipped regression: tailwind-merge kept "relative" and dropped
  // "fixed", so the create-plan dialog rendered below the page fold.
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent className="relative sm:max-w-[680px]">\n',
    "templates/plan/app/pages/PlansPage.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(
    findings[0]!,
    /PlansPage\.tsx:1 <DialogContent> receives "relative"/,
  );
});

test("reads past a JSX handler that contains an arrow", () => {
  // `=>` used to terminate the opening-tag match before className was seen,
  // which let the exact regression this guard exists for walk through it.
  const { findings } = findOverlayPositionOverrides(
    [
      "<DialogContent",
      "  onInteractOutside={(event) => event.preventDefault()}",
      '  className="relative sm:max-w-lg"',
      ">",
    ].join("\n"),
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /App\.tsx:1 <DialogContent> receives "relative"/);
});

test("reads a position utility out of a cn() expression", () => {
  const { findings } = findOverlayPositionOverrides(
    '<SheetContent className={cn("w-80", isDocked && "absolute")} />',
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /<SheetContent> receives "absolute"/);
});

test("flags a responsive position utility on a multi-line overlay tag", () => {
  const { findings } = findOverlayPositionOverrides(
    [
      "const App = () => (",
      "  <SheetContent",
      '    side="right"',
      '    className="sm:absolute w-80"',
      "  >",
      "    <p />",
      "  </SheetContent>",
      ");",
    ].join("\n"),
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(
    findings[0]!,
    /App\.tsx:2 <SheetContent> receives "sm:absolute"/,
  );
});

test("accepts overlay callers that only tune size and spacing", () => {
  const { findings } = findOverlayPositionOverrides(
    [
      '<DialogContent className="sm:max-w-[680px]">',
      '<AlertDialogContent className="max-w-md gap-2">',
      '<DrawerContent className="h-[80vh]">',
    ].join("\n"),
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("does not read position words out of non-class attributes", () => {
  // aria-label="relative" is honest copy, not a tailwind-merge hazard.
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent aria-label="relative" data-variant="sticky" id="absolute" />',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("ignores position utilities on children inside the overlay", () => {
  const { findings } = findOverlayPositionOverrides(
    [
      '<DialogContent className="sm:max-w-lg">',
      '  <div className="relative flex">',
      '    <span className="absolute inset-0" />',
      "  </div>",
      "</DialogContent>",
    ].join("\n"),
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("flags important position utilities in either Tailwind syntax", () => {
  // `!relative` wins the cascade against a non-important `fixed`, and five
  // overlay call sites in this repo already use the important modifier.
  for (const token of ["!relative", "sm:!absolute", "relative!"]) {
    const { findings } = findOverlayPositionOverrides(
      `<DialogContent className="${token} max-w-lg" />`,
      "templates/demo/app/App.tsx",
    );
    assert.equal(findings.length, 1, token);
    assert.match(
      findings[0]!,
      new RegExp(`receives "${token.replace("!", "\\!")}"`),
    );
  }
});

test("does not read a parked className out of a JSX comment", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent {/* className="relative" */} className="max-w-lg" />',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("does not mistake a URL in an attribute for a line comment", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent aria-describedby="https://example.test/docs" className="relative" />',
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "relative"/);
});

test("reads a position utility out of a template-literal interpolation", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent className={`${wide ? "relative" : ""} max-w-lg`} />',
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "relative"/);
});

test("keeps static template-literal text readable", () => {
  const { findings } = findOverlayPositionOverrides(
    "<DialogContent className={`sm:absolute ${width}`} />",
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "sm:absolute"/);
});

test("accepts a template-literal className with no position utility", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent className={`max-w-lg ${wide ? "sm:max-w-3xl" : ""}`} />',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("skips a commented-out overlay example", () => {
  const { findings } = findOverlayPositionOverrides(
    [
      '// <DialogContent className="relative">',
      '/* <SheetContent className="absolute" /> */',
      '<DialogContent className="max-w-lg" />',
    ].join("\n"),
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("still sees a call site sharing a line with a URL in JSX text", () => {
  // Whole-file line-comment masking would blank from `//` to end of line and
  // hide this; the at-line-start rule does not.
  const { findings } = findOverlayPositionOverrides(
    '<p>https://example.test</p><DialogContent className="relative" />',
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "relative"/);
});

test("flags an arbitrary position declaration", () => {
  for (const token of ["[position:relative]", "sm:[position:absolute]"]) {
    const { findings } = findOverlayPositionOverrides(
      `<DialogContent className="${token} max-w-lg" />`,
      "templates/demo/app/App.tsx",
    );
    assert.equal(findings.length, 1, token);
  }
});

test("does not flag unrelated arbitrary declarations", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent className="[overflow:clip] [inset:0]" />',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("skips a call site commented out after code on the same line", () => {
  const { findings, unreadable } = findOverlayPositionOverrides(
    'const note = "see"; // <DialogContent className="relative" />',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
  assert.deepEqual(unreadable, []);
});

test("reads past a block comment containing a closing angle bracket", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent /* documented > container */ className="relative" />',
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "relative"/);
});

test("expands a template literal nested inside an interpolation", () => {
  const { findings } = findOverlayPositionOverrides(
    "<DialogContent className={`${cn(wide && `relative`)} max-w-lg`} />",
    "templates/demo/app/App.tsx",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!, /receives "relative"/);
});

test("honors a reviewed opt-out on the overlay tag", () => {
  const { findings } = findOverlayPositionOverrides(
    '<DialogContent /* overlay-position-ok: rendered into a positioned container */ className="relative">',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
});

test("reports an overlay tag it could not read instead of passing it", () => {
  const { findings, unreadable } = findOverlayPositionOverrides(
    '<DialogContent className="relative"',
    "templates/demo/app/App.tsx",
  );
  assert.deepEqual(findings, []);
  assert.equal(unreadable.length, 1);
  assert.match(unreadable[0]!, /could not read/);
});

test("scans real overlay call sites and reports what it inspected", () => {
  const { root, cleanup } = fixture((dir) => {
    mkdirSync(join(dir, "templates", "demo", "app"), { recursive: true });
    writeFileSync(
      join(dir, "templates", "demo", "app", "Ok.tsx"),
      '<DialogContent className="sm:max-w-lg" />\n',
    );
    writeFileSync(
      join(dir, "templates", "demo", "app", "Broken.tsx"),
      '<DialogContent className="relative" />\n',
    );
    writeFileSync(
      join(dir, "templates", "demo", "app", "Unrelated.tsx"),
      'export const X = () => <div className="relative" />;\n',
    );
  });
  try {
    const result = checkOverlayPositionOverrides(root, ["templates"]);
    assert.equal(result.checked, 2);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!, /Broken\.tsx/);
  } finally {
    cleanup();
  }
});

const PEERS =
  "(@types/react@19.2.17)(react-dom@19.2.7(react@19.2.7))(react@19.2.7)";

function lockfile(snapshotKeys: string[]): string {
  return [
    "packages:",
    "  '@radix-ui/react-dismissable-layer@1.1.19':",
    "    resolution: {integrity: sha512-aaa}",
    "snapshots:",
    ...snapshotKeys.flatMap((key) => [`  '${key}':`, "    dependencies: {}"]),
  ].join("\n");
}

test("flags more than one resolved dismissable-layer version", () => {
  const source = lockfile([
    `@radix-ui/react-dismissable-layer@1.1.11${PEERS}`,
    `@radix-ui/react-dismissable-layer@1.1.13${PEERS}`,
  ]);
  assert.equal(findDuplicateLayerResolutions(source).length, 2);
  const errors = checkLayerSingleton(source);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /resolves to 2 instances/);
  assert.match(errors[0]!, /pointer-events/);
});

test("flags the same version resolved against different peers", () => {
  // Two peer-resolved snapshots are two directories and two module scopes, so
  // collapsing them to the published version would miss the real duplicate.
  const source = lockfile([
    "@radix-ui/react-dismissable-layer@1.1.19(@types/react@18.3.1)(react@18.3.1)",
    `@radix-ui/react-dismissable-layer@1.1.19${PEERS}`,
  ]);
  assert.equal(findDuplicateLayerResolutions(source).length, 2);
  assert.match(checkLayerSingleton(source)[0]!, /resolves to 2 instances/);
});

test("accepts a single resolved dismissable-layer instance", () => {
  const source = lockfile([`@radix-ui/react-dismissable-layer@1.1.19${PEERS}`]);
  assert.deepEqual(findDuplicateLayerResolutions(source), [
    `@radix-ui/react-dismissable-layer@1.1.19${PEERS}`,
  ]);
  assert.deepEqual(checkLayerSingleton(source), []);
});

test("ignores unrelated packages that share the name prefix", () => {
  const source = lockfile([
    `@radix-ui/react-dismissable-layer@1.1.19${PEERS}`,
    `@radix-ui/react-dismissable-layer-extra@9.9.9${PEERS}`,
  ]);
  assert.equal(findDuplicateLayerResolutions(source).length, 1);
});
