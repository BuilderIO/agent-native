import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findDesignE2ETestRegistrations } from "./design-e2e-regression-pins.ts";
import {
  compareQuarantineSnapshots,
  inspectCurrentFiles,
  readBaseExceptions,
  readBaseRegistrations,
  readHeadRegistrations,
  resolveQuarantineBaseCommit,
} from "./guard-e2e-quarantine.mjs";

const baseFixme = {
  file: "existing.spec.ts",
  title: "existing behavior",
  modifier: "fixme",
};

test("an unchanged quarantined test becoming active is a repair", () => {
  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [{ file: baseFixme.file, title: baseFixme.title }],
      [],
    ),
    [],
  );
});

test("a same-count quarantine swap needs removal and addition exceptions", () => {
  const replacement = {
    file: "replacement.spec.ts",
    title: "replacement behavior",
    modifier: "fixme",
  };
  const violations = compareQuarantineSnapshots([baseFixme], [replacement], []);
  assert.match(violations.join("\n"), /suppressed test disappeared/);
  assert.match(
    violations.join("\n"),
    /new test suppression needs an explicit exception/,
  );

  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [replacement],
      [
        {
          action: "remove",
          file: baseFixme.file,
          title: baseFixme.title,
          reason: "The retired test is covered by a replacement.",
          evidence: "issue-123",
        },
        {
          action: "add",
          file: replacement.file,
          title: replacement.title,
          reason: "The replacement exposes a separate unresolved failure.",
          evidence: "issue-456",
          owner: "design-e2e",
          expires: "2026-11-16",
        },
      ],
      "2026-10-16",
    ),
    [],
  );
});

test("new quarantine exceptions fail when review metadata is missing", () => {
  const active = { file: "new.spec.ts", title: "new behavior" };
  const quarantined = { ...active, modifier: "fixme" };
  const violations = compareQuarantineSnapshots(
    [active],
    [quarantined],
    [
      {
        action: "add",
        file: active.file,
        title: active.title,
        reason: "A reproducible failure remains.",
        evidence: "",
        owner: "design-e2e",
        expires: "2026-11-16",
      },
    ],
    "2026-10-16",
  );
  assert.match(violations.join("\n"), /reason\/evidence\/owner/);
});

test("an explicit file and title mapping preserves a renamed quarantine", () => {
  const renamed = {
    file: "renamed.spec.ts",
    title: "clarified behavior",
    modifier: "fixme",
  };
  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [renamed],
      [
        {
          action: "rename",
          from: { file: baseFixme.file, title: baseFixme.title },
          to: { file: renamed.file, title: renamed.title },
          reason: "The test file and title were clarified.",
          evidence: "issue-123",
        },
      ],
    ),
    [],
  );
});

test("quarantine renames cannot collapse into existing or shared identities", () => {
  const second = {
    file: "another.spec.ts",
    title: "another quarantined behavior",
    modifier: "fixme",
  };
  const activeTarget = {
    file: "target.spec.ts",
    title: "preserved active behavior",
  };
  const renamedTarget = {
    ...activeTarget,
    modifier: "fixme",
  };
  const rename = (from: { file: string; title: string }) => ({
    action: "rename",
    from: { file: from.file, title: from.title },
    to: { file: renamedTarget.file, title: renamedTarget.title },
    reason: "The test identity was renamed.",
    evidence: "issue-234",
  });

  assert.match(
    compareQuarantineSnapshots(
      [baseFixme, activeTarget],
      [activeTarget],
      [rename(baseFixme)],
    ).join("\n"),
    /quarantine rename target already exists in the base/,
  );
  assert.match(
    compareQuarantineSnapshots(
      [baseFixme, second],
      [renamedTarget],
      [rename(baseFixme), rename(second)],
    ).join("\n"),
    /multiple quarantine renames target the same identity/,
  );
});

test("missing diff base fails closed with the could-not-run exit code", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-no-base-"));
  try {
    assert.throws(
      () => resolveQuarantineBaseCommit(root),
      (error: NodeJS.ErrnoException & { exitCode?: number }) =>
        error.exitCode === 2,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing quarantine cannot be exchanged for skip, fail, or only", () => {
  for (const modifier of ["skip", "fail", "only"]) {
    const head = findDesignE2ETestRegistrations(
      `test.${modifier}("${baseFixme.title}", () => {});`,
      baseFixme.file,
    );
    const violations = compareQuarantineSnapshots([baseFixme], head, []);
    assert.match(
      violations.join("\n"),
      new RegExp(`existing test\\.fixme was replaced by test\\.${modifier}`),
    );
  }
});

test("AST comparison catches quarantines hidden by enclosing or runtime suppression", () => {
  const activeBase = findDesignE2ETestRegistrations(
    'test("existing behavior", () => {});',
    baseFixme.file,
  );
  const suiteSuppressed = findDesignE2ETestRegistrations(
    'test.describe.fixme("suite", () => { test("existing behavior", () => {}); });',
    baseFixme.file,
  );
  const runtimeSuppressed = findDesignE2ETestRegistrations(
    'test("existing behavior", () => { test.fixme(isMobile, "mobile unsupported"); });',
    baseFixme.file,
  );
  const suiteViolations = compareQuarantineSnapshots(
    activeBase,
    suiteSuppressed,
    [],
  );
  assert.match(suiteViolations.join("\n"), /broad suite modifier/);

  const runtimeViolations = compareQuarantineSnapshots(
    activeBase,
    runtimeSuppressed,
    [],
  );
  assert.match(
    runtimeViolations.join("\n"),
    /new test suppression needs an explicit exception/,
  );

  const formerlyQuarantinedSuppressed = findDesignE2ETestRegistrations(
    'test.describe.fixme("suite", () => { test("existing behavior", () => {}); });',
    baseFixme.file,
  );
  assert.match(
    compareQuarantineSnapshots(
      [baseFixme],
      formerlyQuarantinedSuppressed,
      [],
    ).join("\n"),
    /suppressed test changed to broad suite suppression/,
  );
});

test("regex lookalikes cannot preserve a deleted quarantined identity", () => {
  const base = findDesignE2ETestRegistrations(
    'test.fixme("existing behavior", () => {});',
    baseFixme.file,
  );
  const head = findDesignE2ETestRegistrations(
    [
      'if (condition) /test\\.fixme\\("existing behavior", \\(\\) => \\{\\}\\)/.test(source);',
      'test("replacement active behavior", () => {});',
    ].join("\n"),
    baseFixme.file,
  );
  const violations = compareQuarantineSnapshots(base, head, []);
  assert.match(violations.join("\n"), /suppressed test disappeared/);
  assert.equal(
    head.some(({ title }) => title === baseFixme.title),
    false,
  );
});

test("duplicate identities in the base include active and quarantined registrations", () => {
  const activeDuplicate = {
    file: baseFixme.file,
    title: baseFixme.title,
  };
  const violations = compareQuarantineSnapshots(
    [baseFixme, activeDuplicate],
    [baseFixme],
    [],
  );
  assert.match(violations.join("\n"), /duplicate base test identity/);
});

test("GitHub pull request quarantine checks require the explicit target base", () => {
  const previous = {
    event: process.env.GITHUB_EVENT_NAME,
    githubBase: process.env.GITHUB_BASE_REF,
    guardBase: process.env.GUARD_DIFF_BASE,
  };
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-missing-base-"));
  try {
    process.env.GITHUB_EVENT_NAME = "pull_request";
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GUARD_DIFF_BASE;
    assert.throws(
      () => resolveQuarantineBaseCommit(root),
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

test("unchanged quarantine receipts persist after merge and expire only while active", () => {
  const activeBase = { file: baseFixme.file, title: baseFixme.title };
  const receipt = {
    action: "add",
    file: baseFixme.file,
    title: baseFixme.title,
    reason: "The browser regression remains reproducible.",
    evidence: "issue-567",
    owner: "design-e2e",
    expires: "2026-10-17",
  };

  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [baseFixme],
      [receipt],
      "2026-10-16",
      [receipt],
    ),
    [],
  );
  assert.match(
    compareQuarantineSnapshots(
      [baseFixme],
      [baseFixme],
      [receipt],
      "2026-10-18",
      [receipt],
    ).join("\n"),
    /active quarantine exception.*future/,
  );
  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [activeBase],
      [receipt],
      "2026-10-18",
      [receipt],
    ),
    [],
  );
});

test("unchanged removal and rename receipts persist without authorizing new changes", () => {
  const removal = {
    action: "remove",
    file: baseFixme.file,
    title: baseFixme.title,
    reason: "The obsolete test was replaced by a maintained contract.",
    evidence: "issue-678",
  };
  const rename = {
    action: "rename",
    from: { file: baseFixme.file, title: baseFixme.title },
    to: { file: "renamed.spec.ts", title: "renamed behavior" },
    reason: "The file and title were clarified.",
    evidence: "issue-789",
  };
  const renamedHead = {
    file: "renamed.spec.ts",
    title: "renamed behavior",
    modifier: "fixme",
  };

  assert.deepEqual(
    compareQuarantineSnapshots([], [], [removal], "2026-10-16", [removal]),
    [],
  );
  assert.deepEqual(
    compareQuarantineSnapshots(
      [renamedHead],
      [renamedHead],
      [rename],
      "2026-10-16",
      [rename],
    ),
    [],
  );
  assert.match(
    compareQuarantineSnapshots([baseFixme], [], [removal], "2026-10-16", [
      removal,
    ]).join("\n"),
    /disappeared without a removal or rename exception/,
  );
});

test("nested specs keep e2e-relative identities and nested suppressions are counted", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-nested-"));
  const e2e = join(root, "templates/design/e2e");
  const sameTitle = 'test.fixme("shared behavior", () => {});';
  try {
    for (const group of ["group-a", "group-b"]) {
      mkdirSync(join(e2e, group), { recursive: true });
      writeFileSync(join(e2e, group, "shared.spec.ts"), sameTitle);
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guard test"], { cwd: root });
    execFileSync(
      "git",
      ["config", "user.email", "guard-test@example.invalid"],
      {
        cwd: root,
      },
    );
    execFileSync("git", ["add", "templates/design/e2e"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "nested specs fixture"], {
      cwd: root,
    });

    const base = readBaseRegistrations(root, "HEAD");
    const head = readHeadRegistrations(root);
    assert.deepEqual(
      base.map(({ file }) => file),
      ["group-a/shared.spec.ts", "group-b/shared.spec.ts"],
    );
    assert.deepEqual(
      head.map(({ file }) => file),
      ["group-a/shared.spec.ts", "group-b/shared.spec.ts"],
    );
    assert.deepEqual(readBaseExceptions(root, "HEAD"), []);
    assert.deepEqual(
      compareQuarantineSnapshots(base, head, [], "2026-10-16"),
      [],
    );

    mkdirSync(join(e2e, "group-c"), { recursive: true });
    writeFileSync(
      join(e2e, "group-c", "new.spec.ts"),
      'test.fixme("new nested behavior", () => {});',
    );
    const withNewSuppression = readHeadRegistrations(root);
    const violations = compareQuarantineSnapshots(
      base,
      withNewSuppression,
      [],
      "2026-10-16",
    );
    assert.equal(
      violations.filter((message) =>
        message.includes("new test suppression needs an explicit exception"),
      ).length,
      1,
    );
    assert.equal(inspectCurrentFiles(root).fixmeCount, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every baseline suppression identity needs an explicit removal receipt", () => {
  const sources = [
    'test.skip("existing behavior", () => {});',
    'test.describe.skip("suite", () => { test("existing behavior", () => {}); });',
    'test("existing behavior", () => { test.skip(isMobile, "mobile unsupported"); });',
    'test.skip(true, "conditionally disabled file"); test("existing behavior", () => {});',
    'test.only("focus helper", () => {}); test("existing behavior", () => {});',
  ];

  for (const source of sources) {
    const base = findDesignE2ETestRegistrations(source, baseFixme.file);
    const target = base.find(({ title }) => title === "existing behavior");
    assert.ok(target && isSuppressedRegistration(target), source);
    const headSource = base
      .filter(({ title }) => title !== "existing behavior")
      .map(({ title }) => `test(${JSON.stringify(title)}, () => {});`)
      .join("\n");
    const head = findDesignE2ETestRegistrations(headSource, baseFixme.file);
    const violations = compareQuarantineSnapshots(base, head, []);
    assert.match(
      violations.join("\n"),
      /disappeared without a removal or rename exception/,
      source,
    );
  }
});

test("exact-identity reactivation repairs every baseline suppression kind", () => {
  const sources = [
    'test.skip("existing behavior", () => {});',
    'test.describe.skip("suite", () => { test("existing behavior", () => {}); });',
    'test("existing behavior", () => { test.skip(isMobile, "mobile unsupported"); });',
    'test.skip(true, "conditionally disabled file"); test("existing behavior", () => {});',
    'test.only("focus helper", () => {}); test("existing behavior", () => {});',
  ];
  const activeHead = [
    'test("existing behavior", () => {});',
    'test("focus helper", () => {});',
  ].join("\n");

  for (const source of sources) {
    const base = findDesignE2ETestRegistrations(source, baseFixme.file);
    const head = findDesignE2ETestRegistrations(activeHead, baseFixme.file);
    assert.deepEqual(compareQuarantineSnapshots(base, head, []), [], source);
  }
});

function isSuppressedRegistration(registration) {
  return registration.suppressionKind != null || registration.modifier != null;
}
