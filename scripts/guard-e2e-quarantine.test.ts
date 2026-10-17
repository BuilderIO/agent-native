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

test("renamed quarantines need a separate addition receipt for suppressed targets", () => {
  const renamed = {
    file: "renamed.spec.ts",
    title: "clarified behavior",
    modifier: "fixme",
  };
  const rename = {
    action: "rename",
    from: { file: baseFixme.file, title: baseFixme.title },
    to: { file: renamed.file, title: renamed.title },
    reason: "The test file and title were clarified.",
    evidence: "issue-123",
  };

  assert.match(
    compareQuarantineSnapshots([baseFixme], [renamed], [rename]).join("\n"),
    /new test suppression needs an explicit exception/,
  );
  assert.match(
    compareQuarantineSnapshots(
      [baseFixme],
      [renamed],
      [
        rename,
        {
          action: "add",
          file: renamed.file,
          title: renamed.title,
          reason: "A reproducible failure remains.",
          evidence: "issue-123",
          owner: "",
          expires: "2026-10-16",
        },
      ],
      "2026-10-16",
    ).join("\n"),
    /new suppression exception needs non-empty reason\/evidence\/owner and a future YYYY-MM-DD expiry/,
  );
});

test("a renamed quarantine with a paired addition receipt is accepted", () => {
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
        {
          action: "add",
          file: renamed.file,
          title: renamed.title,
          reason: "The renamed test remains blocked.",
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

test("title renames of direct fixme and skip registrations accept a valid fresh addition", () => {
  for (const modifier of ["fixme", "skip"]) {
    const base = parseSingleSuppressedTest(
      `test.${modifier}("old behavior", () => {});`,
    );
    const head = parseSingleSuppressedTest(
      `test.${modifier}("renamed behavior", () => {});`,
    );
    const rename = {
      action: "rename",
      from: { file: base.file, title: base.title },
      to: { file: head.file, title: head.title },
      reason: "The test title was clarified.",
      evidence: "issue-124",
    };
    const addition = {
      action: "add",
      file: head.file,
      title: head.title,
      reason: "The renamed test remains suppressed after review.",
      evidence: "issue-125",
      owner: "design-e2e",
      expires: "2026-11-16",
    };

    assert.notEqual(base.suppressionFingerprint, head.suppressionFingerprint);
    assert.deepEqual(
      compareQuarantineSnapshots(
        [base],
        [head],
        [rename, addition],
        "2026-10-16",
      ),
      [],
      `${modifier} title rename with a fresh addition receipt`,
    );
  }
});

test("renamed suppression fingerprint changes require one fresh valid addition", () => {
  const base = parseSingleSuppressedTest(
    'test.fixme("old behavior", () => { test.skip(isMobile, "unsupported"); });',
  );
  const head = parseSingleSuppressedTest(
    'test.fixme("renamed behavior", () => { test.skip(isTablet, "unsupported"); });',
  );
  const rename = {
    action: "rename",
    from: { file: base.file, title: base.title },
    to: { file: head.file, title: head.title },
    reason: "The test title was clarified.",
    evidence: "issue-126",
  };
  const addition = {
    action: "add",
    file: head.file,
    title: head.title,
    reason: "The renamed condition was reviewed and remains suppressed.",
    evidence: "issue-127",
    owner: "design-e2e",
    expires: "2026-11-16",
  };

  assert.notEqual(base.suppressionFingerprint, head.suppressionFingerprint);
  const missingAddition = compareQuarantineSnapshots(
    [base],
    [head],
    [rename],
    "2026-10-16",
  ).join("\n");
  assert.match(missingAddition, /invalid quarantine rename exception/);
  assert.match(
    missingAddition,
    /new test suppression needs an explicit exception/,
  );

  for (const [label, invalidAddition] of [
    ["expired", { ...addition, expires: "2026-10-16" }],
    ["malformed", { ...addition, evidence: "" }],
  ]) {
    const violations = compareQuarantineSnapshots(
      [base],
      [head],
      [rename, invalidAddition],
      "2026-10-16",
    ).join("\n");
    assert.match(violations, /invalid quarantine rename exception/, label);
    assert.match(
      violations,
      /new suppression exception needs non-empty reason\/evidence\/owner and a future YYYY-MM-DD expiry/,
      label,
    );
  }

  const duplicateAddition = compareQuarantineSnapshots(
    [base],
    [head],
    [rename, addition, addition],
    "2026-10-16",
  ).join("\n");
  assert.match(duplicateAddition, /duplicate quarantine addition exception/);
  assert.match(duplicateAddition, /invalid quarantine rename exception/);

  assert.deepEqual(
    compareQuarantineSnapshots(
      [base],
      [head],
      [rename, addition],
      "2026-10-16",
    ),
    [],
    "a changed suppression condition is accepted only with the paired fresh receipt",
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

function parseSingleSuppressedTest(source: string) {
  const registrations = findDesignE2ETestRegistrations(source, baseFixme.file);
  assert.equal(registrations.length, 1, source);
  assert.equal(typeof registrations[0]?.suppressionFingerprint, "string");
  return registrations[0]!;
}

test("conditional runtime skip changed to unconditional needs a new receipt", () => {
  const base = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isMobile, "mobile unsupported"); });',
  );
  const head = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(true, "mobile unsupported"); });',
  );

  assert.equal(base.file, head.file);
  assert.equal(base.title, head.title);
  assert.equal(base.suppressionKind, "runtime");
  assert.equal(head.suppressionKind, "runtime");
  assert.match(
    compareQuarantineSnapshots([base], [head], []).join("\n"),
    /new test suppression needs an explicit exception/,
  );
});

test("changed runtime skip condition needs a new receipt for the same identity", () => {
  const base = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isMobile, "unsupported"); });',
  );
  const head = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isTablet, "unsupported"); });',
  );

  assert.notEqual(base.suppressionFingerprint, head.suppressionFingerprint);
  assert.match(
    compareQuarantineSnapshots([base], [head], []).join("\n"),
    /new test suppression needs an explicit exception/,
  );
});

test("changing an enclosing browser predicate needs a new receipt", () => {
  const base = parseSingleSuppressedTest(
    [
      'function skipUnsupported() { test.skip(true, "browser unsupported"); }',
      'test("existing behavior", () => {',
      '  if (browserName === "chromium") skipUnsupported();',
      "});",
    ].join("\n"),
  );
  const head = parseSingleSuppressedTest(
    [
      'function skipUnsupported() { test.skip(true, "browser unsupported"); }',
      'test("existing behavior", () => {',
      '  if (browserName === "webkit") skipUnsupported();',
      "});",
    ].join("\n"),
  );

  assert.equal(base.suppressionKind, "runtime");
  assert.equal(head.suppressionKind, "runtime");
  assert.notEqual(base.suppressionFingerprint, head.suppressionFingerprint);
  assert.match(
    compareQuarantineSnapshots([base], [head], []).join("\n"),
    /new test suppression needs an explicit exception/,
  );
});

test("a runtime suppression condition change accepts a valid review receipt", () => {
  const base = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isMobile, "unsupported"); });',
  );
  const head = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isTablet, "unsupported"); });',
  );

  assert.deepEqual(
    compareQuarantineSnapshots(
      [base],
      [head],
      [
        {
          action: "add",
          file: base.file,
          title: base.title,
          reason: "The tablet-specific browser failure still reproduces.",
          evidence: "issue-901",
          owner: "design-e2e",
          expires: "2026-11-16",
        },
      ],
      "2026-10-16",
    ),
    [],
  );
});

test("moving a runtime suppression without changing it preserves its fingerprint", () => {
  const base = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isMobile, "unsupported"); });',
  );
  const head = parseSingleSuppressedTest(
    '\n\n\ntest("existing behavior", () => { test.skip(isMobile, "unsupported"); });',
  );

  assert.notEqual(base.line, head.line);
  assert.equal(base.suppressionFingerprint, head.suppressionFingerprint);
  assert.deepEqual(compareQuarantineSnapshots([base], [head], []), []);
});

test("changing a runtime suppression between try, catch, and unconditional paths needs a new receipt", () => {
  const catchPath = parseSingleSuppressedTest(
    [
      'test("existing behavior", (_fixtures, testInfo) => {',
      '  try { throw new Error("enter catch"); } catch {',
      '    testInfo.skip(isMobile, "unsupported");',
      "  }",
      "});",
    ].join("\n"),
  );
  const tryPath = parseSingleSuppressedTest(
    [
      'test("existing behavior", (_fixtures, testInfo) => {',
      '  try { testInfo.skip(isMobile, "unsupported"); } catch {}',
      "});",
    ].join("\n"),
  );
  const unconditionalPath = parseSingleSuppressedTest(
    'test("existing behavior", (_fixtures, testInfo) => { testInfo.skip(isMobile, "unsupported"); });',
  );

  assert.notEqual(
    catchPath.suppressionFingerprint,
    tryPath.suppressionFingerprint,
  );
  assert.notEqual(
    catchPath.suppressionFingerprint,
    unconditionalPath.suppressionFingerprint,
  );
  assert.match(
    compareQuarantineSnapshots([catchPath], [tryPath], []).join("\n"),
    /new test suppression needs an explicit exception/,
  );
  assert.match(
    compareQuarantineSnapshots([catchPath], [unconditionalPath], []).join("\n"),
    /new test suppression needs an explicit exception/,
  );
});

test("editing a direct fixme callback does not change its suppression fingerprint", () => {
  const base = parseSingleSuppressedTest(
    'test.fixme("existing behavior", () => { expect(value).toBe(1); });',
  );
  const head = parseSingleSuppressedTest(
    'test.fixme("existing behavior", () => { expect(value).toBe(2); });',
  );

  assert.equal(base.suppressionFingerprint, head.suppressionFingerprint);
  assert.deepEqual(compareQuarantineSnapshots([base], [head], []), []);
});

test("generated callback quarantines are recorded and require an exception", () => {
  assert.throws(
    () =>
      findDesignE2ETestRegistrations(
        '["one"].forEach((name) => { test.fixme(name, () => {}); });',
        baseFixme.file,
      ),
    /Unable to inspect a registration title/,
  );
  const generated = findDesignE2ETestRegistrations(
    '["one"].forEach(() => { test.fixme("one", () => {}); });',
    baseFixme.file,
  );

  assert.deepEqual(generated, [
    {
      file: baseFixme.file,
      title: "one",
      dynamic: false,
      line: 1,
      modifier: "fixme",
      suppressionKind: "direct",
      suppressionReason: "Unable to inspect conditional test.fixme at line 1",
      suppressionFingerprint: JSON.stringify([
        {
          scope: "direct",
          modifier: "fixme",
          callee: "test.fixme",
          arguments: ['"one"'],
        },
      ]),
    },
  ]);
  assert.match(
    compareQuarantineSnapshots([], generated, []).join("\n"),
    /new test suppression needs an explicit exception/,
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

test("an active historical receipt must be retained or validly renewed", () => {
  const activeBase = { file: baseFixme.file, title: baseFixme.title };
  const receipt = {
    action: "add",
    file: baseFixme.file,
    title: baseFixme.title,
    reason: "The browser regression remains reproducible.",
    evidence: "issue-901",
    owner: "design-e2e",
    expires: "2026-10-17",
  };
  const renewal = {
    action: "add",
    file: baseFixme.file,
    title: baseFixme.title,
    reason: "The browser regression still reproduces after investigation.",
    evidence: "issue-902",
    owner: "design-e2e",
    expires: "2026-11-17",
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
    "retaining a valid historical receipt passes",
  );
  assert.match(
    compareQuarantineSnapshots([baseFixme], [baseFixme], [], "2026-10-16", [
      receipt,
    ]).join("\n"),
    /active quarantine exception must be retained or renewed with a new valid add receipt/,
    "deleting a still-valid receipt cannot bypass future expiry enforcement",
  );
  assert.match(
    compareQuarantineSnapshots([baseFixme], [baseFixme], [], "2026-10-18", [
      receipt,
    ]).join("\n"),
    /active quarantine exception needs a non-empty owner and a future YYYY-MM-DD expiry/,
    "deleting an expired receipt cannot bypass expiry enforcement",
  );
  assert.match(
    compareQuarantineSnapshots(
      [baseFixme],
      [baseFixme],
      [receipt],
      "2026-10-18",
      [receipt],
    ).join("\n"),
    /active quarantine exception needs a non-empty owner and a future YYYY-MM-DD expiry/,
    "retaining an expired historical receipt still fails",
  );
  assert.deepEqual(
    compareQuarantineSnapshots([baseFixme], [activeBase], [], "2026-10-18", [
      receipt,
    ]),
    [],
    "an expired receipt does not block a reactivated test",
  );
  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [baseFixme],
      [renewal],
      "2026-10-18",
      [receipt],
    ),
    [],
    "a new valid receipt renews a deleted expired receipt",
  );
  assert.deepEqual(
    compareQuarantineSnapshots(
      [baseFixme],
      [baseFixme],
      [receipt, renewal],
      "2026-10-18",
      [receipt],
    ),
    [],
    "a valid new receipt can renew an expired receipt retained in history",
  );

  const changedBase = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isMobile, "unsupported"); });',
  );
  const changedHead = parseSingleSuppressedTest(
    'test("existing behavior", () => { test.skip(isTablet, "unsupported"); });',
  );
  const changedReceipt = { ...receipt, file: changedBase.file };
  assert.match(
    compareQuarantineSnapshots([changedBase], [changedHead], [], "2026-10-18", [
      changedReceipt,
    ]).join("\n"),
    /new test suppression needs an explicit exception/,
    "a changed suppression still needs its own fresh receipt",
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
  const addition = {
    action: "add",
    file: renamedHead.file,
    title: renamedHead.title,
    reason: "The renamed test still reproduces the browser failure.",
    evidence: "issue-790",
    owner: "design-e2e",
    expires: "2026-11-16",
  };
  const renamedReceipts = [rename, addition];

  assert.deepEqual(
    compareQuarantineSnapshots([], [], [removal], "2026-10-16", [removal]),
    [],
  );
  assert.deepEqual(
    compareQuarantineSnapshots(
      [renamedHead],
      [renamedHead],
      renamedReceipts,
      "2026-10-16",
      renamedReceipts,
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

test("an active renamed quarantine still checks its historical addition expiry", () => {
  const renamedHead = {
    file: "renamed.spec.ts",
    title: "renamed behavior",
    modifier: "fixme",
  };
  const rename = {
    action: "rename",
    from: { file: baseFixme.file, title: baseFixme.title },
    to: { file: renamedHead.file, title: renamedHead.title },
    reason: "The test file and title were clarified.",
    evidence: "issue-789",
  };
  const addition = {
    action: "add",
    file: renamedHead.file,
    title: renamedHead.title,
    reason: "The renamed test still reproduces the browser failure.",
    evidence: "issue-790",
    owner: "design-e2e",
    expires: "2026-11-16",
  };
  const receipts = [rename, addition];

  assert.match(
    compareQuarantineSnapshots(
      [renamedHead],
      [renamedHead],
      receipts,
      "2026-11-17",
      receipts,
    ).join("\n"),
    /active quarantine exception needs a non-empty owner and a future YYYY-MM-DD expiry/,
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

test("head and base discovery match Playwright's default testMatch", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-playwright-files-"));
  const e2e = join(root, "templates/design/e2e");
  const matchingFiles = [
    "nested/.spec.ts",
    "nested/.test.ts",
    "nested/standard.spec.js",
    "nested/standard.test.ts",
    "nested/jsx.spec.jsx",
    "nested/jsx.spec.tsx",
    "nested/tsx.test.tsx",
    "nested/common.spec.cjs",
    "nested/common.test.cts",
    "nested/module.spec.mjs",
    "nested/module.test.mts",
    "nested/common-jsx.spec.cjsx",
    "nested/common-tsx.test.ctsx",
    "nested/module-jsx.spec.mjsx",
    "nested/module-tsx.test.mtsx",
  ].sort();
  try {
    for (const file of matchingFiles) {
      const path = join(e2e, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(
        path,
        file === "nested/jsx.spec.tsx"
          ? [
              `test(${JSON.stringify(file)}, () => <div />);`,
              "// This test still fails while checking JSX parsing.",
              'test.fixme("jsx suppression", () => <span />);',
            ].join("\n")
          : `test(${JSON.stringify(file)}, () => {});`,
      );
    }
    for (const file of [
      "nested/helper.ts",
      "nested/spec.ts",
      "nested/other.spec.json",
    ]) {
      const path = join(e2e, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, 'test.fixme("not a Playwright test", () => {});');
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guard test"], { cwd: root });
    execFileSync(
      "git",
      ["config", "user.email", "guard-test@example.invalid"],
      { cwd: root },
    );
    execFileSync("git", ["add", "templates/design/e2e"], { cwd: root });
    execFileSync(
      "git",
      ["commit", "-qm", "Playwright file discovery fixture"],
      {
        cwd: root,
      },
    );

    const base = readBaseRegistrations(root, "HEAD");
    const head = readHeadRegistrations(root);
    assert.deepEqual(
      [...new Set(base.map(({ file }) => file))].sort(),
      matchingFiles,
    );
    assert.deepEqual(
      [...new Set(head.map(({ file }) => file))].sort(),
      matchingFiles,
    );
    assert.deepEqual(inspectCurrentFiles(root).files, matchingFiles);
    assert.equal(inspectCurrentFiles(root).fixmeCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("multiline fixme callsites count and require a reason before the chain", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-multiline-fixme-"));
  const e2e = join(root, "templates/design/e2e");
  const file = join(e2e, "multiline.spec.ts");
  mkdirSync(e2e, { recursive: true });
  try {
    writeFileSync(
      file,
      [
        "// The browser behavior still fails in the local test environment.",
        "test",
        "  .fixme(",
        '    "multiline quarantined behavior",',
        "    () => {},",
        "  );",
      ].join("\n"),
    );
    const explained = inspectCurrentFiles(root);
    assert.equal(explained.fixmeCount, 1);
    assert.deepEqual(explained.unexplained, []);

    writeFileSync(
      file,
      [
        "test",
        "  .fixme(",
        '    "multiline quarantined behavior",',
        "    () => {},",
        "  );",
      ].join("\n"),
    );
    const unexplained = inspectCurrentFiles(root);
    assert.equal(unexplained.fixmeCount, 1);
    assert.deepEqual(unexplained.unexplained, [
      "templates/design/e2e/multiline.spec.ts:1",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("multiline suppression sites still count against the existing ceilings", () => {
  const root = mkdtempSync(
    join(tmpdir(), "e2e-quarantine-multiline-ceilings-"),
  );
  const e2e = join(root, "templates/design/e2e");
  mkdirSync(e2e, { recursive: true });
  try {
    const lines = [];
    for (let index = 0; index < 228; index += 1) {
      lines.push(
        "// The browser behavior still fails in the local test environment.",
        "test",
        `  .fixme(${JSON.stringify(`quarantined behavior ${index}`)}, () => {});`,
      );
    }
    for (let index = 0; index < 8; index += 1) {
      lines.push(
        "test",
        `  .skip(isMobile, ${JSON.stringify(`conditionally unsupported ${index}`)});`,
      );
    }
    writeFileSync(join(e2e, "multiline.spec.ts"), lines.join("\n"));

    const inspection = inspectCurrentFiles(root);
    assert.equal(inspection.fixmeCount, 228);
    assert.equal(inspection.skipCount, 8);
    assert.ok(inspection.fixmeCount > 227);
    assert.ok(inspection.skipCount > 7);
    assert.deepEqual(inspection.unexplained, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("known suppression aliases, wrappers, and extended tests count once", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-known-callsites-"));
  const e2e = join(root, "templates/design/e2e");
  const file = join(e2e, "known-callsites.spec.ts");
  mkdirSync(e2e, { recursive: true });
  try {
    const source = [
      'import { test as playwrightTest } from "@playwright/test";',
      "const extendedTest = playwrightTest.extend({});",
      "// This known regression still fails in the browser.",
      "playwrightTest",
      '  .fixme("multiline direct", () => {});',
      "// This known regression still fails in the browser.",
      'playwrightTest["fi" + "xme"].call(undefined, "computed call", () => {});',
      "// This known regression still fails in the browser.",
      'extendedTest.fixme("assigned extend alias", () => {});',
      "// This known regression still fails in the browser.",
      'playwrightTest.extend({}).describe["fixme"]("inline extended suite", () => {});',
      "// This known regression still fails in the browser.",
      'playwrightTest.fixme.bind(playwrightTest)("bound suppression", () => {});',
      "// This known regression still fails in the browser.",
      'playwrightTest["fixme"].apply(undefined, ["applied suppression", () => {}]);',
      "// This known regression still fails in the browser.",
      'playwrightTest.fixme.bind.call(playwrightTest.fixme, playwrightTest)("bound call suppression", () => {});',
      'playwrightTest["sk" + "ip"](isMobile, "mobile only");',
      "const factory = { extend: (_fixtures: object) => ({ fixme: () => {} }) };",
      'factory.extend({}).fixme("ordinary factory lookalike", () => {});',
    ].join("\n");
    writeFileSync(file, source);

    const inspection = inspectCurrentFiles(root);
    assert.equal(inspection.fixmeCount, 7);
    assert.equal(inspection.skipCount, 1);
    assert.deepEqual(inspection.unexplained, []);

    writeFileSync(
      file,
      source.replace(
        "// This known regression still fails in the browser.\nextendedTest.fixme",
        "extendedTest.fixme",
      ),
    );
    const unexplained = inspectCurrentFiles(root);
    assert.equal(unexplained.fixmeCount, 7);
    assert.deepEqual(unexplained.unexplained, [
      "templates/design/e2e/known-callsites.spec.ts:8",
    ]);

    writeFileSync(
      file,
      [
        'const modifier = "fixme";',
        'test[modifier]("dynamic suppression", () => {});',
      ].join("\n"),
    );
    assert.throws(
      () => inspectCurrentFiles(root),
      /unsupported dynamic Playwright test modifier callsite/,
    );
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

test("fixme reasons must be actual nonempty comments", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-quarantine-comment-reason-"));
  const e2e = join(root, "templates/design/e2e");
  mkdirSync(e2e, { recursive: true });
  try {
    for (const [prefix, explained] of [
      ["const value = 2\n * 3;", false],
      ["//", false],
      ["/**/", false],
      ["/* The browser behavior still fails. */", true],
      ["/**\n * The browser behavior still fails.\n */", true],
      ["// The browser behavior still fails.\n", true],
    ] as const) {
      writeFileSync(
        join(e2e, "reason.spec.ts"),
        `${prefix}\ntest.fixme("quarantined behavior", () => {});`,
      );
      const result = inspectCurrentFiles(root);
      assert.equal(result.fixmeCount, 1);
      assert.equal(result.unexplained.length, explained ? 0 : 1, prefix);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
