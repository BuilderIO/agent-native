import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertFullCoverage,
  catalogContractAppsForChangedPaths,
  catalogContractCoreSpecs,
  cliEntryCoreSpecs,
  isShardableTestScript,
  partitionTargetedWeighted,
  partitionWeighted,
  readChangedPaths,
  requiresFullCoreFastTests,
  splitLargePackages,
  toolSearchBenchmarkCoreSpecs,
} from "./ci-test-lanes.ts";

const pkgs = (...entries: Array<[string, number]>) =>
  entries.map(([name, files]) => ({ name, files }));

test("gives a package a core shard would push past a fair share its own lane", () => {
  const rest = pkgs(["design", 850], ["a", 400], ["b", 300], ["c", 200]);
  const lanes = partitionWeighted(rest, 4, 1200);
  const design = lanes.find((lane) => lane.packages.includes("design"));
  assert.deepEqual(design?.packages, ["design"]);
  assert.equal(design?.coreShard, "");
  assert.deepEqual(
    lanes
      .map((lane) => lane.coreShard)
      .filter(Boolean)
      .sort(),
    ["1/3", "2/3", "3/3"],
  );
  assert.ok(Math.max(...lanes.map((lane) => lane.files)) <= 850);
  assertFullCoverage(lanes, rest, true);
});

test("shards core across every lane when no package dominates", () => {
  const rest = pkgs(["a", 200], ["b", 150], ["c", 100]);
  const lanes = partitionWeighted(rest, 3, 900);
  assert.deepEqual(lanes.map((lane) => lane.coreShard).sort(), [
    "1/3",
    "2/3",
    "3/3",
  ]);
  assertFullCoverage(lanes, rest, true);
});

test("keeps a solo lane only when it shrinks the largest lane", () => {
  const rest = pkgs(["x", 5000], ["y", 5000]);
  const lanes = partitionWeighted(rest, 2, 100);
  assert.deepEqual(lanes.map((lane) => lane.coreShard).sort(), ["1/2", "2/2"]);
  assert.equal(Math.max(...lanes.map((lane) => lane.files)), 5050);
  assertFullCoverage(lanes, rest, true);
});

test("balances packages without core and never solos them", () => {
  const rest = pkgs(["design", 850], ["a", 100]);
  const lanes = partitionWeighted(rest, 5, null);
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every((lane) => lane.coreShard === ""));
  assertFullCoverage(lanes, rest);
});

test("uses one core shard for a one-file changed selection", () => {
  const rest = pkgs(["design", 8]);
  const lanes = partitionTargetedWeighted(rest, 5, 1, "changed", [
    "src/example.test.ts",
  ]);

  assert.equal(lanes.length, 1);
  assert.equal(lanes[0]?.coreShard, "1/1");
  assert.equal(lanes[0]?.coreMode, "changed");
  assertFullCoverage(lanes, rest, true);
  assert.throws(() => partitionTargetedWeighted(rest, 5, 1, "changed", []));
});

test("does not create a core lane for an empty changed selection", () => {
  const lanes = partitionTargetedWeighted([], 5, 0, "changed");
  assert.deepEqual(lanes, []);
  assertFullCoverage(lanes, []);
});

test("falls back to all core tests for fixture, config, and instruction changes", () => {
  assert.equal(
    requiresFullCoreFastTests([
      "packages/core/src/templates/default/app/config.json",
    ]),
    true,
  );
  assert.equal(
    requiresFullCoreFastTests(["packages/core/src/vitest-config.ts"]),
    true,
  );
  assert.equal(requiresFullCoreFastTests(["vitest.shared.ts"]), true);
  assert.equal(requiresFullCoreFastTests([".agents/skills/qa/SKILL.md"]), true);
  assert.equal(requiresFullCoreFastTests(["AGENTS.md"]), true);
  assert.equal(requiresFullCoreFastTests(["README.md"]), false);
  assert.equal(
    requiresFullCoreFastTests(["packages/core/docs/content/deployment.mdx"]),
    false,
  );
});

void test("includes disk-referenced CLI tests for Core source and launcher changes", () => {
  const specs = [
    "src/cli/create-tui.spec.ts",
    "src/cli/deploy-build.spec.ts",
    "src/cli/telemetry-routing.spec.ts",
    "src/cli/typecheck-ancestor.spec.ts",
    "src/cli/typecheck-command.spec.ts",
    "src/cli/typecheck-path-permissions.spec.ts",
  ];
  for (const changed of [
    "packages/core/src/cli/index.ts",
    "packages/core/src/cli/process.ts",
    "packages/core/src/cli/react-router-command.ts",
    "packages/core/src/shared/optional-peer.ts",
    "packages/core/bin/agent-native.js",
  ]) {
    assert.deepEqual(cliEntryCoreSpecs([changed]), specs, changed);
  }
  assert.deepEqual(
    cliEntryCoreSpecs(["packages/core/src/cli/index.spec.ts"]),
    [],
  );
  assert.deepEqual(cliEntryCoreSpecs(["packages/other/src/index.ts"]), []);
  assert.equal(requiresFullCoreFastTests(["packages/core/package.json"]), true);
});

test("runs the catalog contract specs for any workspace source change", (t) => {
  const root = mkdtempSync(join(tmpdir(), "standalone-e2e-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runners = [
    "templates/analytics-2/e2e/thread-layout.ts",
    "templates/mail/e2e/daily/run.ts",
    "packages/core/e2e/run.ts",
  ];
  for (const runner of runners) {
    mkdirSync(join(root, runner, ".."), { recursive: true });
    writeFileSync(join(root, runner), "console.log(process.argv.slice(2));");
  }
  writeFileSync(
    join(root, "templates/mail/e2e/helper.ts"),
    "export const args = process.argv.slice(2);",
  );
  const specs = [
    "src/action-conformance-inventory.spec.ts",
    "src/mcp/advertised-tool-annotations.spec.ts",
    "src/mcp/agent-mcp-parity.spec.ts",
    "src/mcp/instructions-name-advertised-tools.spec.ts",
    "src/mcp/hidden-inline-apps.spec.ts",
  ];
  const specsWithoutHiddenInline = specs.filter(
    (spec) => spec !== "src/mcp/hidden-inline-apps.spec.ts",
  );
  for (const changed of [
    "templates/mail/actions/send-email.ts",
    "templates/mail/actions/e2e/inspect-catalog.ts",
    "templates/mail/e2e/helper.ts",
    "templates/mail/e2e/unreadable.ts",
    "templates/content/server/lib/chatgpt-directory-tools.ts",
    "templates/slides/shared/api.ts",
    "templates/design/app/lib/design-tokens.ts",
    "templates/mail/agent-native.json",
    "templates/mail/package.json",
    "packages/core/src/server/agent-chat-plugin.ts",
    "packages/core/src/resources/actions/delete-resource.ts",
    "packages/core/src/coding-tools/index.ts",
    "packages/core/src/mcp/server.ts",
    "packages/core/src/triggers/actions.ts",
    "packages/core/src/notifications/actions.ts",
    // A package that registers tools into the plugin from outside core.
    "packages/creative-context/src/actions/x.ts",
    // A package no list could have named in advance.
    "packages/made-up-package/src/lib/register-tools.ts",
  ]) {
    assert.deepEqual(catalogContractCoreSpecs([changed], root), specs, changed);
  }
  for (const changed of [
    "templates/forms/server/plugins/agent-chat.ts",
    "templates/newapp/actions/create-thing.ts",
    "templates/newapp/scripts/run-task.ts",
  ]) {
    assert.deepEqual(
      catalogContractCoreSpecs([changed], root),
      specsWithoutHiddenInline,
      changed,
    );
  }
  assert.equal(
    catalogContractAppsForChangedPaths(
      ["templates/forms/server/plugins/agent-chat.ts"],
      root,
    ),
    "forms",
  );
  assert.equal(
    catalogContractAppsForChangedPaths(
      [
        "templates/mail/actions/send-email.ts",
        "templates/forms/actions/save-form.ts",
      ],
      root,
    ),
    "forms,mail",
  );
  assert.equal(
    catalogContractAppsForChangedPaths(
      [
        "templates/mail/actions/send-email.ts",
        "packages/core/src/mcp/server.ts",
      ],
      root,
    ),
    "",
  );
  for (const unrelated of [
    "templates/mail/actions/send-email.test.ts",
    ...runners,
    "templates/mail/app/routes/inbox.spec.tsx",
    "packages/creative-context/src/actions/x.spec.ts",
    "packages/core/src/server/agent-chat-plugin.lifecycle.spec.ts",
    "templates/mail/server/types.d.ts",
    "templates/mail/app/global.css",
    "templates/mail/public/logo.svg",
    "packages/made-up-package/assets/icon.png",
    "templates/mail/README.md",
    "packages/core/docs/content/external-agents-catalog.mdx",
    "packages/core/CHANGELOG.md",
    ".changeset/declare-coding-tool-mcp-annotations.md",
    "docs/guide.md",
    "community-templates/demo/actions/do-thing.ts",
  ]) {
    assert.deepEqual(
      catalogContractCoreSpecs([unrelated], root),
      [],
      unrelated,
    );
  }
  assert.deepEqual(
    catalogContractCoreSpecs([
      "packages/core/docs/content/external-agents-catalog.mdx",
      "templates/mail/README.md",
      ".changeset/declare-coding-tool-mcp-annotations.md",
    ]),
    [],
    "a docs-only change",
  );
});

test("runs the tool-search benchmark only for template action and shared changes", () => {
  const spec = ["src/agent/tool-search.benchmark.spec.ts"];
  for (const changed of [
    "templates/mail/actions/manage-draft.ts",
    "templates/newapp/actions/nested/create-thing.ts",
    "templates/mail/shared/automation-schema.ts",
  ]) {
    assert.deepEqual(toolSearchBenchmarkCoreSpecs([changed]), spec, changed);
  }
  for (const unrelated of [
    "templates/mail/actions/manage-draft.spec.ts",
    "templates/mail/shared/automation-schema.spec.ts",
    "templates/mail/app/routes/inbox.tsx",
    "templates/mail/server/lib/automations.ts",
    "templates/mail/actions/README.md",
    "packages/core/src/agent/tool-search.ts",
    "packages/creative-context/src/actions/x.ts",
  ]) {
    assert.deepEqual(toolSearchBenchmarkCoreSpecs([unrelated]), [], unrelated);
  }
});

test("refuses lanes that skip or repeat a core shard", () => {
  const lane = (coreShard: string, packages: string[] = []) => ({
    lane: "lane",
    filters: "",
    packages,
    packageShards: [],
    files: 1,
    coreShard,
    coreMode: coreShard ? "full" : "",
  });
  assert.throws(
    () => assertFullCoverage([lane("1/2"), lane("1/2")], [], true),
    /missing or duplicated/,
  );
  assert.throws(
    () => assertFullCoverage([lane("1/3"), lane("2/3")], [], true),
    /missing or duplicated/,
  );
});

test("shards a Vitest package heavier than a fair lane share", () => {
  const rest = [
    { name: "design", files: 900, shardable: true },
    { name: "a", files: 300 },
    { name: "b", files: 300 },
  ];
  const lanes = partitionWeighted(rest, 6, 900);
  const designShards = lanes
    .flatMap((lane) => lane.packageShards)
    .filter((shard) => shard.name === "design")
    .map((shard) => shard.shard)
    .sort();
  assert.deepEqual(designShards, ["1/3", "2/3", "3/3"]);
  assert.ok(lanes.every((lane) => !lane.packages.includes("design")));
  assert.ok(Math.max(...lanes.map((lane) => lane.files)) <= 450);
  assertFullCoverage(lanes, rest, true);
});

test("a configured shard minimum splits Toolkit across separate lanes without changing other work", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ci-package-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [dir, name, files, script] of [
    ["toolkit", "@agent-native/toolkit", 240, "vitest --run"],
    ["other", "other", 320, "vitest --run"],
    ["tiny", "tiny", 1, "vitest --run"],
    ["custom", "custom", 1, "node --test"],
  ] as const) {
    const workspace = join(root, "packages", dir);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ name, scripts: { test: script } }),
    );
    for (let index = 0; index < files; index++) {
      writeFileSync(join(workspace, `fixture-${index}.spec.ts`), "");
    }
  }

  const toolkit = "@agent-native/toolkit";
  const planner = fileURLToPath(new URL("./ci-test-lanes.ts", import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, LANES: "2" };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  delete env.CI_WORKSPACE_FILTERS;
  delete env.CI_MIN_PACKAGE_SHARDS;
  const run = (minimums?: string) =>
    spawnSync(process.execPath, ["--experimental-strip-types", planner], {
      cwd: root,
      encoding: "utf8",
      env:
        minimums === undefined
          ? env
          : { ...env, CI_MIN_PACKAGE_SHARDS: minimums },
    });
  const matrix = (result: ReturnType<typeof run>) => {
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout
      .split("\n")
      .find((line) => line.startsWith("matrix="));
    assert.ok(output);
    return (
      JSON.parse(output.slice("matrix=".length)) as {
        include: ReturnType<typeof partitionWeighted>;
      }
    ).include;
  };
  const baseline = matrix(run());
  assert.equal(
    baseline.filter((lane) => lane.packages.includes(toolkit)).length,
    1,
  );

  const sharded = matrix(run(JSON.stringify({ [toolkit]: 2 })));
  assert.equal(sharded.length, baseline.length);
  assert.ok(sharded.every((lane) => !lane.packages.includes(toolkit)));
  const toolkitShards = sharded.map((lane) =>
    lane.packageShards
      .filter((shard) => shard.name === toolkit)
      .map((shard) => shard.shard),
  );
  assert.deepEqual(toolkitShards.sort(), [["1/2"], ["2/2"]]);
  const otherWork = (lanes: ReturnType<typeof partitionWeighted>) =>
    lanes
      .flatMap((lane) => [
        ...lane.packages.filter((name) => name !== toolkit),
        ...lane.packageShards
          .filter(({ name }) => name !== toolkit)
          .map(({ name, shard }) => `${name}:${shard}`),
      ])
      .sort();
  assert.deepEqual(otherWork(sharded), otherWork(baseline));
  assert.deepEqual(matrix(run("{}")), baseline);

  for (const [input, error] of [
    ["{", /CI_MIN_PACKAGE_SHARDS.*JSON/],
    ["[]", /CI_MIN_PACKAGE_SHARDS.*object/],
    [JSON.stringify({ [toolkit]: "2" }), /CI_MIN_PACKAGE_SHARDS.*integer/],
    [JSON.stringify({ [toolkit]: 3 }), /CI_MIN_PACKAGE_SHARDS.*integer/],
    ['{"unknown":2}', /CI_MIN_PACKAGE_SHARDS.*unknown/],
    ['{"custom":2}', /CI_MIN_PACKAGE_SHARDS.*custom.*shardable/],
    ['{"tiny":2}', /CI_MIN_PACKAGE_SHARDS.*tiny.*2/],
  ] as const) {
    const result = run(input);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
    assert.equal(result.stdout, "");
  }
});

void test("keeps required Toolkit shards on distinct lanes in each planning mode", () => {
  const toolkit = {
    name: "@agent-native/toolkit",
    files: 200,
    shardable: true,
  };
  const minimums = new Map([[toolkit.name, 2]]);
  const weighted = [...pkgs(["big-a", 1000]), toolkit];
  const solo = [...weighted, ...pkgs(["big-b", 1000])];
  for (const { label, lanes, work, coreFiles } of [
    {
      label: "no Core",
      lanes: partitionWeighted(weighted, 2, null, minimums),
      work: weighted,
      coreFiles: 0,
    },
    {
      label: "solo search",
      lanes: partitionWeighted(solo, 3, 10, minimums),
      work: solo,
      coreFiles: 10,
    },
    {
      label: "targeted Core",
      lanes: partitionTargetedWeighted(
        weighted,
        2,
        1,
        "changed",
        ["a.spec.ts"],
        minimums,
      ),
      work: weighted,
      coreFiles: 1,
    },
  ]) {
    assertFullCoverage(lanes, work, coreFiles, minimums);
    const toolkitShards = lanes
      .map((lane) =>
        lane.packageShards
          .filter(({ name }) => name === toolkit.name)
          .map(({ shard }) => shard),
      )
      .filter((shards) => shards.length > 0);
    assert.deepEqual(toolkitShards.sort(), [["1/2"], ["2/2"]], label);
    assert.equal(
      lanes.reduce((count, lane) => count + lane.files, 0),
      work.reduce((count, pkg) => count + pkg.files, coreFiles),
      label,
    );
  }
});

test("shards a Vitest script behind a pnpm prefix such as Design's bridge codegen", () => {
  assert.equal(isShardableTestScript("vitest --run"), true);
  assert.equal(
    isShardableTestScript("pnpm codegen:bridge && vitest --run"),
    true,
  );
  assert.equal(isShardableTestScript("tsx scripts/run.ts"), false);
  assert.equal(isShardableTestScript("pnpm build && tsx run-tests.ts"), false);
  assert.equal(isShardableTestScript("vitestx --run"), false);
  assert.equal(isShardableTestScript("vitest --run && tsc"), false);
  assert.equal(isShardableTestScript("vitest --run; echo done"), false);
  assert.equal(isShardableTestScript("vitest --run | tee out.log"), false);
  assert.equal(isShardableTestScript("vitest --run\necho done"), false);
  assert.equal(isShardableTestScript("vitest --run # note"), false);
  assert.equal(isShardableTestScript("vitest\t--run"), true);
});

test("keeps packages whole when they are unshardable or too small to split", () => {
  assert.deepEqual(splitLargePackages([{ name: "custom", files: 900 }], 6, 0), [
    { name: "custom", files: 900 },
  ]);
  assert.deepEqual(
    splitLargePackages([{ name: "small", files: 150, shardable: true }], 8, 0),
    [{ name: "small", files: 150 }],
  );
});

// oracle-change: remove tests for the deleted Slides 2 template
test("shards a targeted package alongside changed core tests", () => {
  const rest = [{ name: "design", files: 800, shardable: true }];
  const lanes = partitionTargetedWeighted(rest, 4, 4, "changed", [
    "src/a.test.ts",
    "src/b.test.ts",
    "src/c.test.ts",
    "src/d.test.ts",
  ]);
  assert.equal(lanes.flatMap((lane) => lane.packageShards).length, 4);
  assertFullCoverage(lanes, rest, true);
});

test("refuses lanes that skip, repeat, or also run a sharded package whole", () => {
  const lane = (
    packageShards: Array<{ name: string; shard: string }>,
    packages: string[] = [],
  ) => ({
    lane: "lane",
    filters: "",
    packages,
    packageShards,
    files: 1,
    coreShard: "",
    coreMode: "" as const,
  });
  const expected = [{ name: "design" }];
  assert.throws(
    () =>
      assertFullCoverage([lane([{ name: "design", shard: "1/2" }])], expected),
    /design test shards are missing or duplicated/,
  );
  assert.throws(
    () =>
      assertFullCoverage(
        [
          lane([{ name: "design", shard: "1/2" }], ["design"]),
          lane([{ name: "design", shard: "2/2" }]),
        ],
        expected,
      ),
    /design test shards are missing or duplicated/,
  );
  assert.throws(
    () =>
      assertFullCoverage(
        [
          lane([
            { name: "design", shard: "1/2" },
            { name: "design", shard: "2/2" },
          ]),
        ],
        expected,
        undefined,
        new Map([["design", 2]]),
      ),
    /design must run on at least 2 distinct lanes/,
  );
  assertFullCoverage(
    [
      lane([{ name: "design", shard: "1/2" }]),
      lane([{ name: "design", shard: "2/2" }]),
    ],
    expected,
  );
});

test("reads changed paths in a blobless clone without fetching blobs", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-test-lanes-blobless-"));
  const sourcePath = join(root, "source");
  const clonePath = join(root, "clone");
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };

  try {
    mkdirSync(sourcePath);
    git(sourcePath, "init", "--quiet");
    git(sourcePath, "config", "user.name", "CI Test Lanes Test");
    git(sourcePath, "config", "user.email", "ci-test-lanes@example.invalid");
    const body = Array.from({ length: 40 }, (_, line) => `line ${line}\n`);
    writeFileSync(join(sourcePath, "old.ts"), body.join(""));
    git(sourcePath, "add", "--all");
    git(sourcePath, "commit", "--quiet", "-m", "base");
    const baseSha = git(sourcePath, "rev-parse", "HEAD");
    rmSync(join(sourcePath, "old.ts"));
    writeFileSync(join(sourcePath, "new.ts"), [...body, "edited\n"].join(""));
    git(sourcePath, "add", "--all");
    git(sourcePath, "commit", "--quiet", "-m", "head");

    git(
      root,
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      "--upload-pack",
      "git -c uploadpack.allowFilter=true upload-pack",
      `file://${sourcePath}`,
      clonePath,
    );
    git(
      clonePath,
      "remote",
      "set-url",
      "origin",
      "https://invalid.example/none.git",
    );

    assert.deepEqual(readChangedPaths(baseSha, clonePath).sort(), [
      "new.ts",
      "old.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
