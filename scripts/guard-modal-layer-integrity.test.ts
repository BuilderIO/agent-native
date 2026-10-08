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
