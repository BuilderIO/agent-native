import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS,
  NPM_PUBLISH_PACKAGE_NAMES,
  ensureLocalRuntimeDependenciesAvailable,
  isAlreadyStaged,
  preparePackagesForTagging,
} from "./changeset-publish-sequential.ts";
import { packagesCoveredBy } from "./check-changeset.mjs";
import {
  gitBlobSha,
  syncCommunityQrBlobPins,
  syncCommunityQrCoreLock,
} from "./sync-community-qr-core-lock.ts";
import {
  assertCompletePullRequestFiles,
  assertCommunityQrFilePinsSynced,
  decodeGitHubContentResponse,
  parseCompletePullRequestFiles,
} from "./verify-community-qr-release-pin.ts";
import {
  assertReleaseOnlyPullRequestFiles,
  extractPullRequestFileNames,
} from "./verify-release-package-files.ts";

type Workflow = Record<string, unknown>;

const changesetsRequire = createRequire(
  createRequire(import.meta.url).resolve("@changesets/cli"),
);
const semver = changesetsRequire("semver") as {
  inc: (version: string, release: "patch") => string | null;
  satisfies: (version: string, range: string) => boolean;
};

const workflow = parse(
  readFileSync(".github/workflows/auto-publish.yml", "utf8"),
) as Workflow;
const publisherSource = readFileSync(
  "scripts/changeset-publish-sequential.ts",
  "utf8",
);
const ciLintJob = (
  parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    jobs: Record<string, { name: string; steps: Workflow[] }>;
  }
).jobs.lint;
const trigger = workflow.on as Workflow;
const dispatch = trigger.workflow_dispatch as Workflow;
const inputs = dispatch.inputs as Workflow;
const jobs = workflow.jobs as Workflow;
const autoMergeWorkflow = parse(
  readFileSync(".github/workflows/auto-merge-version-packages.yml", "utf8"),
) as Workflow;

describe("npm package release workflow", () => {
  it("offers an explicit stable bump with patch as the default", () => {
    assert.deepEqual(inputs.releaseType, {
      description: "Stable release bump for all public npm packages",
      required: true,
      type: "choice",
      options: ["patch", "minor", "major"],
      default: "patch",
    });
  });

  it("publishes nightly snapshots, never beta snapshots or tags", () => {
    const nightly = jobs["publish-nightly"] as Workflow;
    const source = JSON.stringify(nightly);
    const publishStep = (nightly.steps as Workflow[]).find(
      (step) => step.name === "Publish nightly packages sequentially",
    );
    assert(publishStep);

    assert.match(String(nightly.if), /github\.event_name == 'schedule'/);
    assert.doesNotMatch(String(nightly.if), /github\.event_name == 'push'/);
    assert.deepEqual(nightly.needs, ["detect-nightly-changes"]);
    assert.match(
      String(nightly.if),
      /needs\.detect-nightly-changes\.outputs\.changed == 'true'/,
    );
    assert.doesNotMatch(
      String(nightly.if),
      /contains\(github\.event\.head_commit\.message/,
    );
    assert.match(source, /--snapshot nightly/);
    assert.equal(
      (publishStep.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
      "nightly",
    );
    assert.doesNotMatch(source, /--snapshot beta/);
    assert.doesNotMatch(source, /AGENT_NATIVE_NPM_DIST_TAG: beta/);
  });

  it("publishes nightly snapshots on a three-hour schedule, not per merge", () => {
    assert.deepEqual(trigger.schedule, [{ cron: "17 */3 * * *" }]);

    const detect = jobs["detect-nightly-changes"] as Workflow;
    assert.match(String(detect.if), /github\.event_name == 'schedule'/);
    const detectStep = (detect.steps as Workflow[]).find(
      (step) => step.id === "detect",
    );
    assert(detectStep);
    const detectSource = String(detectStep.run);
    assert.match(detectSource, /event=schedule&branch=main&status=success/);
    assert.match(detectSource, /git diff --quiet "\$last_sha" HEAD/);

    const nightlyPaths = String((detectStep.env as Workflow).NIGHTLY_PATHS)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const push = trigger.push as { paths: string[] };
    assert.deepEqual(nightlyPaths, push.paths);
  });

  it("skips the stable verifier on ordinary pushes", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    assert.match(
      String(verifier.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(verifier.if),
      /contains\(github\.event\.head_commit\.message, '\[stable-release\]'\)/,
    );
  });

  it("rejects a marked ordinary push from the stable lane", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const release = jobs.release as Workflow;

    assert.doesNotMatch(String(release.if), /head_commit\.message/);
    assert.match(
      String(release.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(JSON.stringify(verifier), /stable_marker/);
    assert.match(JSON.stringify(verifier), /ACTOR/);
    assert.match(JSON.stringify(verifier), /commits\/\$SHA\/pulls/);
  });

  it("keeps stable releases behind a manual dispatch or marked merge", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const verifierSource = JSON.stringify(verifier);
    const release = jobs.release as Workflow;
    const condition = String(release.if);
    const notify = jobs["notify-downstream"] as Workflow;

    assert.match(
      condition,
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(verifierSource, /commits\/\$SHA\/pulls/);
    assert.match(verifierSource, /changeset-release\/main/);
    assert.match(verifierSource, /builder-io-integration\[bot\]/);
    assert.match(verifierSource, /merge_commit_sha == \$sha/);
    assert.deepEqual(notify.needs, ["release", "verify-stable-merge"]);
    assert.match(
      String(notify.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(notify.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
  });

  it("uses calculated semver bases for nightly snapshots", () => {
    const config = JSON.parse(
      readFileSync(".changeset/config.json", "utf8"),
    ) as { snapshot?: { useCalculatedVersion?: boolean } };

    assert.equal(config.snapshot?.useCalculatedVersion, true);
  });

  it("supports the next fixed-group Core patch without the incompatible gap release", () => {
    const corePackage = JSON.parse(
      readFileSync("packages/core/package.json", "utf8"),
    ) as { version: string; exports?: Record<string, unknown> };
    const toolkitPackage = JSON.parse(
      readFileSync("packages/toolkit/package.json", "utf8"),
    ) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const changesetConfig = JSON.parse(
      readFileSync(".changeset/config.json", "utf8"),
    ) as { fixed?: string[][] };

    assert.ok(corePackage.exports?.["./shared"]);
    assert.ok(
      changesetConfig.fixed?.some(
        (group) =>
          group.includes("@agent-native/core") &&
          group.includes("@agent-native/toolkit"),
      ),
    );
    const corePeerRange =
      toolkitPackage.peerDependencies?.["@agent-native/core"];
    assert.ok(corePeerRange);

    const acceptsNextCorePatch = (coreVersion: string) => {
      const nextCorePatch = semver.inc(coreVersion, "patch");
      return (
        nextCorePatch !== null && semver.satisfies(nextCorePatch, corePeerRange)
      );
    };

    for (const coreVersion of [corePackage.version, "0.205.0"]) {
      assert.ok(
        acceptsNextCorePatch(coreVersion),
        `Toolkit must accept the next fixed-group Core patch after ${coreVersion}`,
      );
    }

    for (const coreVersion of ["0.204.0", "0.205.0"]) {
      assert.equal(
        semver.satisfies(coreVersion, corePeerRange),
        false,
        `Toolkit must not accept published Core ${coreVersion} without the sanitizer export`,
      );
    }

    assert.equal(
      semver.satisfies("0.204.1", corePeerRange),
      false,
      "Toolkit must require Core 0.205.1, which first includes the session slot export",
    );

    for (const coreVersion of ["0.205.1"]) {
      assert.ok(
        semver.satisfies(coreVersion, corePeerRange),
        `Toolkit must accept Core ${coreVersion} with the session slot export`,
      );
    }

    assert.equal(
      toolkitPackage.peerDependenciesMeta?.["@agent-native/core"]?.optional,
      true,
    );
  });

  it("keeps the release changeset package list aligned with the publisher", () => {
    const source = readFileSync("scripts/create-release-changeset.ts", "utf8");
    assert.match(source, /NPM_PUBLISH_PACKAGE_NAMES/);
    assert.equal(NPM_PUBLISH_PACKAGE_NAMES.length, 11);
  });

  it("allows npm propagation to settle before failing a publish", () => {
    assert.equal(DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS, 30 * 60_000);
    assert.match(publisherSource, /preparePackagesForTagging\(/);
  });

  it("waits for npm staged versions to become fetchable before tagging", () => {
    const stagedConflict =
      'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/@agent-native%2fdispatch - Cannot publish over previously staged version "0.38.7".';

    assert.equal(isAlreadyStaged(stagedConflict), true);
    assert.equal(
      isAlreadyStaged("npm error code E409\nnpm error 409 Conflict"),
      false,
    );
    assert.match(
      publisherSource,
      /if \(isAlreadyStaged\(output\)\)[\s\S]*?return true;/,
    );
  });

  it("validates Changesets YAML frontmatter", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-native-changeset-"));
    const changeset = path.join(dir, "invalid.md");

    try {
      writeFileSync(changeset, "Not a changeset\n");
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected YAML frontmatter between --- lines/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": nonsense\n---\nInvalid bump\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected package entries with none, patch, minor, or major bumps/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": patch\n---not-a-closing-delimiter\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected YAML frontmatter between --- lines/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": patch\n"@agent-native/core": minor\n---\n',
      );
      assert.throws(
        () => packagesCoveredBy(changeset),
        /invalid YAML frontmatter/,
      );

      writeFileSync(changeset, "---\n- patch\n---\n");
      assert.throws(
        () => packagesCoveredBy(changeset),
        /expected a YAML package-to-bump map/,
      );

      writeFileSync(
        changeset,
        '---\n"@agent-native/core": "patch" # release\n"@agent-native/dispatch": none\n"@agent-native/pinpoint": minor\n"@agent-native/toolkit": major\n---\nValid bumps\n',
      );
      assert.deepEqual(packagesCoveredBy(changeset), [
        "@agent-native/core",
        "@agent-native/dispatch",
        "@agent-native/pinpoint",
        "@agent-native/toolkit",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs the YAML parser before checking changesets in CI", () => {
    assert.equal(ciLintJob.name, "Lint & format");
    const steps = ciLintJob.steps;
    const install = steps.findIndex(
      (step) => step.uses === "./.github/actions/setup-pnpm",
    );
    const check = steps.findIndex(
      (step) => step.run === "node scripts/check-changeset.mjs",
    );
    const bumpPolicy = steps.findIndex(
      (step) => step.run === "node scripts/guard-no-major-changeset.mjs",
    );
    assert.ok(install >= 0 && install < check && check < bumpPolicy);
    for (const index of [check, bumpPolicy]) {
      const condition = String(steps[index].if);
      assert.match(
        condition,
        /needs\.change-scope\.outputs\.changeset == 'true'/,
      );
      assert.match(condition, /head\.ref != 'changeset-release\/main'/);
    }
    assert.equal(
      (steps[check].env as Workflow).GITHUB_BASE_REF,
      "${{ github.base_ref }}",
    );
  });

  it("consumes concurrent public changesets after stable publication", () => {
    const release = jobs.release as Workflow;
    const releaseSteps = release.steps as Workflow[];
    const build = releaseSteps.find(
      (step) => step.name === "Build publishable packages",
    );
    assert(build);
    const buildFilters = [
      ...String(build.run).matchAll(/--filter\s+([^\s]+)/g),
    ].map((match) => match[1].replace(/^['"]|['"]$/g, ""));
    assert.deepEqual(
      buildFilters,
      NPM_PUBLISH_PACKAGE_NAMES.map((name) => `${name}...`),
    );

    const hold = releaseSteps.find(
      (step) => step.name === "Hold pending changesets for stable publication",
    );
    assert(hold);
    const policy = releaseSteps.find(
      (step) => step.name === "Enforce package bump policy",
    );
    assert(policy);
    assert.equal(policy.run, "node scripts/guard-no-major-changeset.mjs");
    assert.match(String(hold.if), /github\.event_name == 'push'/);
    assert.match(JSON.stringify(hold), /RUNNER_TEMP/);
    assert.match(String(hold.run), /changeset status --output/);
    assert.match(JSON.stringify(hold), /README\.md/);
    for (const packageName of NPM_PUBLISH_PACKAGE_NAMES) {
      assert.match(
        String(hold.run),
        new RegExp(packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    const changesets = releaseSteps.find(
      (step) => step.name === "Create stable Release PR or publish to npm",
    );
    assert(changesets);
    const options = changesets.with as Workflow;
    assert.equal(options.version, "pnpm changeset:release-version");
    assert.equal(options["version-script"], undefined);
    const packageScripts = JSON.parse(readFileSync("package.json", "utf8"))
      .scripts as Record<string, string>;
    assert.equal(
      packageScripts["changeset:release-version"],
      "pnpm changeset:version && pnpm exec tsx scripts/sync-community-qr-core-lock.ts && pnpm changelog:compact",
    );

    const consume = releaseSteps.find(
      (step) => step.name === "Consume concurrent public-package changesets",
    );
    assert(consume);
    assert.match(String(consume.if), /github\.event_name == 'push'/);
    assert.match(String(consume.if), /steps\.changesets\.outcome == 'success'/);
    assert.match(String(consume.run), /git push origin HEAD:main/);
    assert.match(String(consume.run), /main:refs\/remotes\/origin\/main/);
    assert.match(String(consume.run), /git rebase --autostash origin\/main/);
    assert.match(String(consume.run), /git diff --name-only --diff-filter=U/);
    assert.match(
      String(consume.run),
      /Autostash restoration conflicted after rebase/,
    );
    assert.match(String(consume.run), /git cat-file -e/);
    assert.match(String(consume.run), /\[skip ci\]/);

    const restore = releaseSteps.find(
      (step) => step.name === "Restore pending changesets",
    );
    assert(restore);
    assert.match(String(restore.if), /always\(\)/);
    assert.match(String(restore.run), /consume-stable-changesets\.outcome/);

    const validateIndex = releaseSteps.findIndex(
      (step) => step.name === "Validate changesets",
    );
    const holdIndex = releaseSteps.indexOf(hold);
    const policyIndex = releaseSteps.indexOf(policy);
    const changesetsIndex = releaseSteps.indexOf(changesets);
    const consumeIndex = releaseSteps.indexOf(consume);
    const restoreIndex = releaseSteps.indexOf(restore);
    assert(holdIndex < validateIndex);
    assert(policyIndex < holdIndex);
    assert(holdIndex < changesetsIndex);
    assert(changesetsIndex < consumeIndex);
    assert(consumeIndex < restoreIndex);
    assert(changesetsIndex < restoreIndex);
  });

  it("syncs the community QR release importer to the in-repo Core package", () => {
    const lockfile = `lockfileVersion: '9.0'
importers:
  templates/community/qr:
    dependencies:
      '@agent-native/core':
        specifier: ^0.212.0
        version: 0.212.0(425ad63e441766c7cc702a9e78bce500)
      postgres:
        specifier: ^3.4.9
        version: 3.4.9

  templates/analytics:
    dependencies: {}
`;

    const updated = syncCommunityQrCoreLock(lockfile, "^0.213.0");

    assert.match(
      updated,
      /specifier: \^0\.213\.0\n        version: link:\.\.\/\.\.\/\.\.\/packages\/core/,
    );
    assert.match(updated, /specifier: \^3\.4\.9\n        version: 3\.4\.9/);
    assert.match(updated, /  templates\/analytics:\n    dependencies: \{\}/);
    assert.equal(syncCommunityQrCoreLock(updated, "^0.213.0"), updated);
    assert.throws(
      () => syncCommunityQrCoreLock("importers: {}\n", "^0.213.0"),
      /Missing templates\/community\/qr importer/,
    );
  });

  it("keeps the committed community QR importer synced with its manifest", () => {
    const templatePackage = JSON.parse(
      readFileSync("templates/community/qr/package.json", "utf8"),
    ) as { dependencies?: Record<string, unknown> };
    const coreSpecifier = templatePackage.dependencies?.["@agent-native/core"];
    assert(typeof coreSpecifier === "string");

    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    assert.equal(syncCommunityQrCoreLock(lockfile, coreSpecifier), lockfile);
  });

  it("rewrites the QR template blob pins from the files on disk", () => {
    const source = `templatePath: "templates/other-first",
      files: [
        {
          path: "package.json",
          blobSha: "${"d".repeat(40)}",
        },
      ],
    },
    {
      templatePath: "templates/community/qr",
      files: [
        {
          path: "package.json",
          blobSha: "${"a".repeat(40)}",
        },
        {
          path: "README.md",
          blobSha: "${"b".repeat(40)}",
        },
      ],
    },
    {
      templatePath: "templates/other",
      files: [
        {
          path: "package.json",
          blobSha: "${"c".repeat(40)}",
        },
      ],
    },`;

    const updated = syncCommunityQrBlobPins(source, (file) =>
      file === "package.json" ? "1".repeat(40) : "2".repeat(40),
    );

    assert.match(updated, /package\.json",\n\s+blobSha: "1{40}"/);
    assert.match(updated, /README\.md",\n\s+blobSha: "2{40}"/);
    assert.match(updated, /blobSha: "c{40}"/);
    assert.match(updated, /blobSha: "d{40}"/);
    assert.equal(
      syncCommunityQrBlobPins(updated, (file) =>
        file === "package.json" ? "1".repeat(40) : "2".repeat(40),
      ),
      updated,
    );
    assert.throws(
      () => syncCommunityQrBlobPins("export {};\n", () => "x"),
      /Missing templates\/community\/qr source/,
    );
    assert.equal(
      gitBlobSha(Buffer.from("hello\n")),
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });

  it("accepts all synchronized community QR template pins and rejects other catalog changes", () => {
    const basePackage = Buffer.from('{"name":"qr","version":"0.40.35"}\n');
    const headPackage = Buffer.from('{"name":"qr","version":"0.40.36"}\n');
    const headReadme = Buffer.from("updated QR template docs\n");
    const headAction = Buffer.from("updated QR action\n");
    const source = (pins: Map<string, string>) => `
      templatePath: "templates/community/qr",
      files: [
        ${["package.json", "README.md", "actions/run.ts"]
          .map(
            (path) => `{
          path: "${path}",
          blobSha: "${pins.get(path)}",
        }`,
          )
          .join(",\n        ")},
      ],
    },`;
    const baseSource = source(
      new Map([
        ["package.json", gitBlobSha(basePackage)],
        ["README.md", "b".repeat(40)],
        ["actions/run.ts", "d".repeat(40)],
      ]),
    );
    const headFiles = new Map([
      ["package.json", headPackage],
      ["README.md", headReadme],
      ["actions/run.ts", headAction],
    ]);
    const headPins = new Map(
      [...headFiles].map(([path, content]) => [path, gitBlobSha(content)]),
    );
    const headSource = source(headPins);

    assert.doesNotThrow(() =>
      assertCommunityQrFilePinsSynced(baseSource, headSource, headPins),
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          source(new Map(headPins).set("package.json", "c".repeat(40))),
          headPins,
        ),
      /Head QR template blob pin does not match package.json/,
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          headSource,
          new Map([...headPins].filter(([path]) => path !== "README.md")),
        ),
      /Missing head QR template blob for README.md/,
    );
    assert.throws(
      () =>
        assertCommunityQrFilePinsSynced(
          baseSource,
          headSource.replace(
            'templatePath: "templates/community/qr",',
            'templatePath: "templates/community/qr",\n      description: "unexpected",',
          ),
          headPins,
        ),
      /Community app catalog does not match the synchronized QR template file pins/,
    );
  });

  it("rejects incomplete or capped pull request file listings", () => {
    assert.deepEqual(assertCompletePullRequestFiles(["one", "two"], 2), [
      "one",
      "two",
    ]);
    assert.throws(
      () => assertCompletePullRequestFiles(["one"], 2),
      /GitHub returned 1 of 2 changed pull request files/,
    );
    assert.throws(
      () => assertCompletePullRequestFiles([], 3_000),
      /endpoint is capped at 3000/,
    );
  });

  it("rejects pull request file lists at GitHub's 3,000-file cap", () => {
    const belowLimit = Array.from(
      { length: 2_999 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");
    const atLimit = Array.from(
      { length: 3_000 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");

    assert.equal(parseCompletePullRequestFiles(belowLimit).length, 2_999);
    assert.throws(
      () => parseCompletePullRequestFiles(atLimit),
      /pull request files API reached its 3,000-file limit/,
    );
  });

  it("checks complete release paths as filenames and rejects embedded newlines", () => {
    const allowedFiles = [
      ".changeset/release.md",
      "packages/core/package.json",
      "packages/dispatch/src/server/lib/community-apps.ts",
    ];
    assert.deepEqual(
      assertReleaseOnlyPullRequestFiles(allowedFiles, allowedFiles.length),
      allowedFiles,
    );
    assert.throws(
      () =>
        assertReleaseOnlyPullRequestFiles(
          [".changeset/release.md\npackages/core/package.json"],
          1,
        ),
      /filename with control characters/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles(["README.md"], 1),
      /unexpected release PR path/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles(["package.json"], 2),
      /returned 1 of 2 changed pull request files/,
    );
    assert.throws(
      () => assertReleaseOnlyPullRequestFiles([], 3_000),
      /endpoint is capped at 3000/,
    );
  });

  it("collects filenames from every paginated GitHub file response", () => {
    assert.deepEqual(
      extractPullRequestFileNames([
        [{ filename: ".changeset/release.md" }],
        [
          { filename: "package.json" },
          { filename: "packages/core/CHANGELOG.md" },
        ],
      ]),
      [".changeset/release.md", "package.json", "packages/core/CHANGELOG.md"],
    );
    assert.throws(
      () => extractPullRequestFileNames([[{ filename: 1 }]]),
      /invalid pull request file list/,
    );
  });

  it("rejects unreadable or incomplete GitHub Contents API responses", () => {
    const content = Buffer.from("manifest");
    assert.deepEqual(
      decodeGitHubContentResponse(
        {
          encoding: "base64",
          content: content.toString("base64"),
          size: content.length,
        },
        "manifest.json",
        "head-sha",
      ),
      content,
    );

    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "none", content: "", size: 1_048_577 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned unreadable file content/,
    );
    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "base64", content: "%%%", size: 3 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned invalid base64 content/,
    );
    assert.throws(
      () =>
        decodeGitHubContentResponse(
          { encoding: "base64", content: "bWFuaWZlc3Q=", size: 99 },
          "manifest.json",
          "head-sha",
        ),
      /GitHub returned incomplete file content/,
    );
  });

  it("rejects pull request file lists at GitHub's 3,000-file cap", () => {
    const belowLimit = Array.from(
      { length: 2_999 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");
    const atLimit = Array.from(
      { length: 3_000 },
      (_, index) => `file-${index}.txt`,
    ).join("\n");

    assert.equal(parseCompletePullRequestFiles(belowLimit).length, 2_999);
    assert.throws(
      () => parseCompletePullRequestFiles(atLimit),
      /pull request files API reached its 3,000-file limit/,
    );
  });

  it("runs the community QR pin guard from the base commit before auto-merge", () => {
    const autoMergeTriggers = autoMergeWorkflow.on as Workflow;
    const workflowDispatch = autoMergeTriggers.workflow_dispatch as Workflow;
    const workflowDispatchInputs = workflowDispatch.inputs as Workflow;
    const autoMergeJobs = autoMergeWorkflow.jobs as Workflow;
    const autoMergeJob = autoMergeJobs["auto-merge"] as Workflow;
    const autoMergeSteps = autoMergeJob.steps as Workflow[];
    const checkout = autoMergeSteps.find(
      (step) =>
        step.uses ===
        "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    );
    const releaseDiff = autoMergeSteps.find(
      (step) => step.name === "Verify release-only diff",
    );
    const qrPinGuard = autoMergeSteps.find(
      (step) => step.name === "Verify community QR template pins",
    );
    const releasePrContext = autoMergeSteps.find(
      (step) => step.name === "Verify release PR identity and event-bound SHAs",
    );
    const manualDispatcherGate = autoMergeSteps.find(
      (step) =>
        step.name === "Verify manual release dispatcher is an administrator",
    );
    const majorPromotionGuard = autoMergeSteps.find(
      (step) => step.name === "Refuse unattended major promotions",
    );
    const requiredChecks = autoMergeSteps.find(
      (step) => step.name === "Wait for required release PR checks",
    );
    const releasePrRecheck = autoMergeSteps.find(
      (step) => step.name === "Revalidate release PR before merge",
    );
    const forceMerge = autoMergeSteps.find(
      (step) => step.name === "Force-merge with admin bypass",
    );

    for (const input of ["pull_request_number", "base_sha", "head_sha"]) {
      assert.equal((workflowDispatchInputs[input] as Workflow).required, true);
    }
    assert.match(
      String(autoMergeJob.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(String(autoMergeJob.if), /github\.ref == 'refs\/heads\/main'/);

    assert.match(
      String(autoMergeJob.if),
      /github\.event\.pull_request\.head\.ref == 'changeset-release\/main'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /github\.event\.pull_request\.user\.login == 'builder-io-integration\[bot\]'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /github\.event\.sender\.login == 'builder-io-integration\[bot\]'/,
    );
    assert.match(
      String(autoMergeJob.if),
      /!github\.event\.pull_request\.draft/,
    );

    assert(checkout);
    assert.equal(
      (checkout.with as Workflow).ref,
      "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.sha || github.event.pull_request.base.sha }}",
    );
    assert(manualDispatcherGate);
    assert.match(
      String(manualDispatcherGate.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String((manualDispatcherGate.env as Workflow).DISPATCH_ACTOR),
      /github\.triggering_actor/,
    );
    assert.match(
      String(manualDispatcherGate.run),
      /collaborators\/\$DISPATCH_ACTOR\/permission/,
    );
    assert.match(
      String(manualDispatcherGate.run),
      /dispatch_permission" != "admin"/,
    );
    assert(releasePrContext);
    assert.match(String(releasePrContext.run), /\.user\.login/);
    assert.match(
      String(releasePrContext.run),
      /\.head\.repo\.full_name == \$repo/,
    );
    assert.match(String(releasePrContext.run), /\.head\.sha == \$head/);
    assert.match(String(releasePrContext.run), /\.base\.sha == \$base/);
    assert(requiredChecks);
    assert.match(String(requiredChecks.run), /--required --watch/);
    assert.match(String(requiredChecks.run), /all\(\.\[\]; \.bucket == "pass"/);
    assert(releaseDiff);
    assert.match(String(releaseDiff.run), /verify-release-package-files\.ts/);
    assert(majorPromotionGuard);
    assert.match(
      String((majorPromotionGuard.env as Workflow).BASE_SHA),
      /inputs\.base_sha/,
    );
    assert.match(
      String((majorPromotionGuard.env as Workflow).HEAD_SHA),
      /inputs\.head_sha/,
    );
    assert.match(
      String((majorPromotionGuard.env as Workflow).PR_NUMBER),
      /inputs\.pull_request_number/,
    );
    assert.match(String(majorPromotionGuard.run), /"--slurp"/);
    assert.match(String(majorPromotionGuard.run), /JSON\.parse\(gh\(/);
    assert.doesNotMatch(String(majorPromotionGuard.run), /\.split\("\\n"\)/);
    assert.match(String(majorPromotionGuard.run), /HTTP 404/);
    assert.match(String(majorPromotionGuard.run), /status === "added"/);
    assert.match(String(majorPromotionGuard.run), /status === "removed"/);
    assert.doesNotMatch(
      String(majorPromotionGuard.run),
      /catch\s*\{\s*return null/,
    );
    assert(qrPinGuard);
    assert.equal(
      qrPinGuard.run,
      "node --experimental-strip-types scripts/verify-community-qr-release-pin.ts",
    );
    assert(releasePrRecheck);
    assert.match(String(releasePrRecheck.run), /\.state == "open"/);
    assert.match(String(releasePrRecheck.run), /\.user\.login/);
    assert.match(
      String(releasePrRecheck.run),
      /\.head\.repo\.full_name == \$repo/,
    );
    assert.match(String(releasePrRecheck.run), /\.head\.sha == \$head/);
    assert.match(String(releasePrRecheck.run), /\.base\.sha == \$base/);
    assert.match(String(releasePrRecheck.run), /--required --json name,bucket/);
    assert(forceMerge);
    assert.match(String(forceMerge.run), /branches\/main/);
    assert.match(String(forceMerge.run), /current_main.*BASE_SHA/s);
    assert.match(String(forceMerge.run), /--match-head-commit "\$HEAD_SHA"/);
    assert.match(
      String(forceMerge.run),
      /Required release PR checks are no longer green/,
    );
  });

  it("waits until local runtime packages are fetchable before publishing dependents", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: {
        name: "@agent-native/dispatch",
        version: "0.40.32",
        dependencies: { "@agent-native/core": "^0.213.0" },
        devDependencies: { "@agent-native/toolkit": "^0.0.0" },
        peerDependencies: { "@agent-native/pinpoint": "^0.0.0" },
      },
    };
    const fetchable = new Set<string>();
    const failed = new Set<string>();
    const checks: string[] = [];

    await ensureLocalRuntimeDependenciesAvailable(
      dispatchPackage,
      [core, dispatchPackage],
      async (dependency) => {
        checks.push(dependency.name);
      },
      fetchable,
      failed,
    );

    assert.deepEqual(checks, ["@agent-native/core"]);
    assert.deepEqual([...fetchable], ["@agent-native/core"]);

    await ensureLocalRuntimeDependenciesAvailable(
      dispatchPackage,
      [core, dispatchPackage],
      async (dependency) => {
        checks.push(dependency.name);
      },
      fetchable,
      failed,
    );
    assert.deepEqual(checks, ["@agent-native/core"]);
  });

  it("marks an unavailable dependency failed and skips later dependents", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: {
        name: "@agent-native/dispatch",
        version: "0.40.32",
        dependencies: { "@agent-native/core": "^0.213.0" },
      },
    };
    const toolkitPackage = {
      dir: "packages/toolkit",
      name: "@agent-native/toolkit",
      version: "0.14.0",
      packageJson: {
        name: "@agent-native/toolkit",
        version: "0.14.0",
        dependencies: { "@agent-native/core": "^0.213.0" },
      },
    };
    const fetchable = new Set<string>();
    const failed = new Set<string>();
    const checks: string[] = [];

    await assert.rejects(
      ensureLocalRuntimeDependenciesAvailable(
        dispatchPackage,
        [core, dispatchPackage, toolkitPackage],
        async (dependency) => {
          checks.push(dependency.name);
          throw new Error(`${dependency.name} is not fetchable`);
        },
        fetchable,
        failed,
      ),
      /@agent-native\/core is not fetchable/,
    );
    assert.deepEqual([...failed], ["@agent-native/core"]);

    await assert.rejects(
      ensureLocalRuntimeDependenciesAvailable(
        toolkitPackage,
        [core, dispatchPackage, toolkitPackage],
        async (dependency) => {
          checks.push(dependency.name);
        },
        fetchable,
        failed,
      ),
      /@agent-native\/toolkit depends on failed local runtime package: @agent-native\/core/,
    );
    assert.deepEqual(checks, ["@agent-native/core"]);
  });

  it("does not retry failed availability checks before tagging independent packages", async () => {
    const core = {
      dir: "packages/core",
      name: "@agent-native/core",
      version: "0.213.0",
      packageJson: { name: "@agent-native/core", version: "0.213.0" },
    };
    const dispatchPackage = {
      dir: "packages/dispatch",
      name: "@agent-native/dispatch",
      version: "0.40.32",
      packageJson: { name: "@agent-native/dispatch", version: "0.40.32" },
    };
    const unrelatedPackage = {
      dir: "packages/otel",
      name: "@agent-native/otel",
      version: "0.1.14",
      packageJson: { name: "@agent-native/otel", version: "0.1.14" },
    };
    const fetchable = new Set<string>();
    const failed = new Set(["@agent-native/core"]);
    const checks: string[] = [];

    const result = await preparePackagesForTagging(
      [core, dispatchPackage, unrelatedPackage],
      async (pkg) => {
        checks.push(pkg.name);
        if (pkg.name === "@agent-native/dispatch") {
          throw new Error("dispatch is not fetchable");
        }
      },
      fetchable,
      failed,
    );

    assert.deepEqual(checks, ["@agent-native/dispatch", "@agent-native/otel"]);
    assert.deepEqual(result.packages, [unrelatedPackage]);
    assert.deepEqual(
      result.failures.map(({ pkg, error }) => [
        pkg.name,
        (error as Error).message,
      ]),
      [["@agent-native/dispatch", "dispatch is not fetchable"]],
    );
    assert.deepEqual(
      [...failed],
      ["@agent-native/core", "@agent-native/dispatch"],
    );
    assert.deepEqual([...fetchable], ["@agent-native/otel"]);
  });

  describe("dev snapshot publishing", () => {
    const devSnapshot = jobs["publish-dev-snapshot"] as Workflow;

    it("exposes an optional devTag dispatch input, empty by default", () => {
      assert.deepEqual(inputs.devTag, {
        description:
          "Dev snapshot: publish a testable version from this branch under npm dist-tag dev-<value> (leave empty for a normal stable dispatch)",
        required: false,
        type: "string",
        default: "",
      });
    });

    it("only runs on a manual dispatch with a non-empty devTag", () => {
      assert(devSnapshot);
      assert.match(
        String(devSnapshot.if),
        /github\.event_name == 'workflow_dispatch'/,
      );
      assert.match(String(devSnapshot.if), /inputs\.devTag != ''/);
      assert.doesNotMatch(String(devSnapshot.if), /needs\.verify-stable-merge/);
      assert.equal(devSnapshot.needs, undefined);
    });

    it("is not gated to main and does not depend on verify-stable-merge", () => {
      assert.equal(workflow.on, trigger);
      assert.doesNotMatch(JSON.stringify(devSnapshot), /branches/);
    });

    it("validates the tag and synthesizes a changeset before versioning", () => {
      const steps = devSnapshot.steps as Workflow[];
      const prepare = steps.find(
        (step) => step.name === "Validate dev tag and prepare a changeset",
      );
      assert(prepare);
      assert.match(String(prepare.run), /prepare-dev-snapshot\.ts/);

      const version = steps.find(
        (step) => step.name === "Create dev snapshot versions",
      );
      assert(version);
      assert.match(
        String(version.run),
        /changeset version --snapshot "\$DEV_TAG"/,
      );

      const prepareIndex = steps.indexOf(prepare);
      const versionIndex = steps.indexOf(version);
      assert(prepareIndex < versionIndex);
    });

    it("publishes under a dev-prefixed dist-tag via the sequential publisher", () => {
      const steps = devSnapshot.steps as Workflow[];
      const publish = steps.find(
        (step) => step.name === "Publish dev snapshot packages sequentially",
      );
      assert(publish);
      assert.equal(publish.id, "publish");
      assert.equal(
        (publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
        "dev-${{ inputs.devTag }}",
      );
      assert.equal(publish.run, "node scripts/changeset-publish-sequential.ts");
      assert.doesNotMatch(
        String((publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG),
        /^(latest|nightly)$/,
      );
    });

    it("reuses the npm-publish environment for OIDC trusted publishing", () => {
      assert.equal(devSnapshot.environment, "npm-publish");
      assert.deepEqual(devSnapshot.permissions, {
        contents: "read",
        "id-token": "write",
      });
    });

    it("summarizes using the publish step's actual output, not a directory scan", () => {
      const steps = devSnapshot.steps as Workflow[];
      const summary = steps.find(
        (step) => step.name === "Summarize dev snapshot publish",
      );
      assert(summary);
      assert.equal(
        (summary.env as Workflow).PUBLISHED_PACKAGES,
        "${{ steps.publish.outputs.published-packages }}",
      );
      assert.doesNotMatch(
        String(summary.run),
        /readdir|ls packages|find packages/,
      );
    });

    it("has its own concurrency lane keyed by branch and tag", () => {
      const group = String((workflow.concurrency as Workflow).group);
      assert.match(group, /inputs\.devTag/);
      assert.match(group, /format\('dev-\{0\}', inputs\.devTag\)/);
      assert.match(group, /stable-preparation/);
      assert.match(group, /stable-publication/);
    });

    it("gates the stable release job off when devTag is set", () => {
      const release = jobs.release as Workflow;
      assert.match(String(release.if), /!inputs\.devTag/);
    });

    it("excludes dev snapshot dispatches from downstream notification", () => {
      const notify = jobs["notify-downstream"] as Workflow;
      assert.match(String(notify.if), /!inputs\.devTag/);
    });
  });
});
