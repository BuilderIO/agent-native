import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkLayerSingleton,
  checkTemplateStyleSources,
  findDuplicateLayerResolutions,
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

test("flags more than one resolved dismissable-layer copy", () => {
  const lockfile = [
    "  '@radix-ui/react-dismissable-layer@1.1.11':",
    "    resolution: {integrity: sha512-aaa}",
    "  '@radix-ui/react-dismissable-layer@1.1.13':",
    "    resolution: {integrity: sha512-bbb}",
  ].join("\n");
  assert.deepEqual(findDuplicateLayerResolutions(lockfile), [
    "1.1.11",
    "1.1.13",
  ]);
  const errors = checkLayerSingleton(lockfile);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /resolves to 2 versions/);
  assert.match(errors[0]!, /pointer-events/);
});

test("accepts a single resolved dismissable-layer copy", () => {
  const lockfile = [
    "  '@radix-ui/react-dismissable-layer@1.1.19':",
    "    resolution: {integrity: sha512-aaa}",
    "  '@radix-ui/react-dismissable-layer@1.1.19(react@19.2.7)':",
    "    dependencies: {}",
  ].join("\n");
  assert.deepEqual(findDuplicateLayerResolutions(lockfile), ["1.1.19"]);
  assert.deepEqual(checkLayerSingleton(lockfile), []);
});
