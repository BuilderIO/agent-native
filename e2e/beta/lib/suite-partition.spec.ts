import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";

// Lists the suite the way each workflow slot selects it and checks that the
// slots partition every authenticated project: no test dropped, none run
// twice. A project, shard or spec file that falls outside every slot would
// otherwise just never run, and nothing would be red.

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const specsDir = path.join(repoRoot, "e2e", "beta", "specs");
const NON_AUTHED_PROJECTS = new Set(["public", "fleet", "advisory"]);

interface Slot {
  slot: string;
  project: string;
  app?: string;
  shard?: string;
}

interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tests: Array<{ projectName: string }>;
}

interface JsonSuite {
  title: string;
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

interface JsonReport {
  config: { projects: Array<{ name: string }> };
  suites: JsonSuite[];
  errors?: Array<{ message?: string }>;
}

interface ListedTest {
  project: string;
  file: string;
  id: string;
}

function readSlots(): Slot[] {
  const workflow = parse(
    readFileSync(
      path.join(repoRoot, ".github", "workflows", "beta-e2e.yml"),
      "utf8",
    ),
  ) as {
    jobs?: { authed?: { strategy?: { matrix?: { include?: Slot[] } } } };
  };
  const slots = workflow.jobs?.authed?.strategy?.matrix?.include;
  assert.ok(slots && slots.length > 0, "the authed matrix lists no slots");
  return slots;
}

function specFilesOnDisk(dir: string = specsDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFilesOnDisk(full);
    return entry.name.endsWith(".spec.ts")
      ? [path.relative(specsDir, full).split(path.sep).join("/")]
      : [];
  });
}

const listings = new Map<
  string,
  Promise<{ projects: string[]; tests: ListedTest[] }>
>();

/** What `playwright test --list` selects for these arguments, as the workflow runs them. */
function list(
  args: string[],
  apps: string,
): Promise<{ projects: string[]; tests: ListedTest[] }> {
  const key = `${apps}|${args.join(" ")}`;
  const cached = listings.get(key);
  if (cached) return cached;
  const env: Record<string, string | undefined> = {
    ...process.env,
    BETA_E2E_APPS: apps,
    BETA_E2E_AUTHED: "0",
  };
  for (const name of [
    "CI",
    "BETA_E2E_CLUSTER",
    "BETA_E2E_GREP",
    "BETA_E2E_REPORT_SLOT",
  ]) {
    delete env[name];
  }
  const pending = execFileAsync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "e2e/beta/playwright.config.ts",
      "--list",
      "--reporter=json",
      ...args,
    ],
    { cwd: repoRoot, env, maxBuffer: 64 * 1024 * 1024 },
  ).then(({ stdout }) => {
    const report = JSON.parse(stdout) as JsonReport;
    assert.deepEqual(
      report.errors ?? [],
      [],
      `playwright --list ${args.join(" ")} reported errors`,
    );
    const tests: ListedTest[] = [];
    const walk = (suite: JsonSuite, titles: string[]): void => {
      const here =
        suite.title === suite.file || !suite.title
          ? titles
          : [...titles, suite.title];
      for (const spec of suite.specs ?? []) {
        for (const listed of spec.tests) {
          tests.push({
            project: listed.projectName,
            file: spec.file,
            id: [
              listed.projectName,
              spec.file,
              [...here, spec.title].join(" > "),
              spec.line,
            ].join(" | "),
          });
        }
      }
      for (const child of suite.suites ?? []) walk(child, here);
    };
    for (const suite of report.suites) walk(suite, []);
    return {
      projects: report.config.projects.map((project) => project.name),
      tests,
    };
  });
  listings.set(key, pending);
  return pending;
}

function ids(tests: ListedTest[], project?: string): Set<string> {
  return new Set(
    tests
      .filter((entry) => project === undefined || entry.project === project)
      .map((entry) => entry.id),
  );
}

function sample(values: Iterable<string>): string {
  return [...values].slice(0, 5).join("\n  ");
}

test(
  "every spec file is run by exactly one project",
  { timeout: 180_000 },
  async () => {
    const everything = await list([], "all");
    const projectsByFile = new Map<string, Set<string>>();
    for (const entry of everything.tests) {
      const projects = projectsByFile.get(entry.file) ?? new Set<string>();
      projects.add(entry.project);
      projectsByFile.set(entry.file, projects);
    }
    const unclaimed = specFilesOnDisk().filter(
      (file) => !projectsByFile.has(file),
    );
    assert.deepEqual(
      unclaimed,
      [],
      `no Playwright project in e2e/beta/playwright.config.ts runs these spec files (or they declare no tests):\n  ${unclaimed.join("\n  ")}`,
    );
    const shared = [...projectsByFile].filter(
      ([, projects]) => projects.size > 1,
    );
    assert.deepEqual(
      shared.map(([file, projects]) => `${file}: ${[...projects].join(", ")}`),
      [],
      "these spec files are run by more than one project, so every test in them runs twice",
    );
  },
);

test(
  "public, fleet and advisory projects each select tests",
  { timeout: 180_000 },
  async () => {
    const everything = await list([], "all");
    for (const project of NON_AUTHED_PROJECTS) {
      assert.ok(
        ids(everything.tests, project).size > 0,
        `project ${project} selects no tests, so its workflow job would run nothing`,
      );
    }
  },
);

test(
  "the workflow's authenticated slots cover every authenticated project's tests exactly once",
  { timeout: 300_000 },
  async () => {
    const slots = readSlots();
    const everything = await list([], "all");
    const authedProjects = everything.projects.filter(
      (project) => !NON_AUTHED_PROJECTS.has(project),
    );
    assert.ok(
      authedProjects.length > 0,
      "the config defines no authed project",
    );

    for (const project of authedProjects) {
      const mine = slots.filter((slot) => slot.project === project);
      assert.ok(
        mine.length > 0,
        `no slot in .github/workflows/beta-e2e.yml runs project ${project}`,
      );
      const full = ids(everything.tests, project);
      assert.ok(full.size > 0, `project ${project} selects no tests`);

      const bySlot = await Promise.all(
        mine.map(async (slot) => {
          const args = [`--project=${slot.project}`];
          if (slot.shard) args.push(`--shard=${slot.shard}`);
          const listed = await list(args, slot.app || "all");
          return { slot, tests: ids(listed.tests, project) };
        }),
      );

      const union = new Set(bySlot.flatMap(({ tests }) => [...tests]));
      const dropped = [...full].filter((id) => !union.has(id));
      assert.deepEqual(
        dropped,
        [],
        `${dropped.length} test(s) of project ${project} are in no slot:\n  ${sample(dropped)}`,
      );
      const invented = [...union].filter((id) => !full.has(id));
      assert.deepEqual(
        invented,
        [],
        `slots of project ${project} select tests the full listing does not have:\n  ${sample(invented)}`,
      );

      for (const { slot, tests } of bySlot) {
        assert.ok(
          tests.size > 0,
          `slot ${slot.slot} selects no tests of project ${project}`,
        );
      }

      // An app-sharded project (chat) lists its app-independent tests, which
      // skip themselves at run time, in every shard. Everything else is cut by
      // file or by --shard, so two slots must never list the same test.
      if (mine.every((slot) => !slot.app)) {
        const seen = new Map<string, string>();
        for (const { slot, tests } of bySlot) {
          for (const id of tests) {
            const other = seen.get(id);
            assert.equal(
              other,
              undefined,
              `slots ${other} and ${slot.slot} both run ${id}`,
            );
            seen.set(id, slot.slot);
          }
        }
      }
    }
  },
);

test(
  "a sharded project's shards are balanced enough to share a time limit",
  { timeout: 180_000 },
  async () => {
    const sharded = readSlots().filter((slot) => slot.shard);
    for (const project of new Set(sharded.map((slot) => slot.project))) {
      const sizes = await Promise.all(
        sharded
          .filter((slot) => slot.project === project)
          .map(async (slot) => {
            const listed = await list(
              [`--project=${slot.project}`, `--shard=${slot.shard}`],
              slot.app || "all",
            );
            return listed.tests.length;
          }),
      );
      assert.ok(
        Math.max(...sizes) - Math.min(...sizes) <= 2,
        `shards of ${project} hold ${sizes.join(", ")} tests; rebalance them so one slot cannot carry most of the run`,
      );
    }
  },
);
