import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { validateContentProductDocs } from "./validate-content-product-docs.ts";
import {
  analyzeContentProductImpact,
  collectTransitions,
  directContentEvidence,
  parseContentImpactDeclaration,
} from "./validate-content-product-impact.ts";

const fixture = "scripts/fixtures/content-product-docs/valid";
const repositoryRoot = process.cwd();
const checkerPath = path.join(
  repositoryRoot,
  "scripts/validate-content-product-impact.ts",
);
const tsxPath = path.join(repositoryRoot, "node_modules/.bin/tsx");
let temporaryRoot = "";
let baseRoot = "";
let headRoot = "";

function declaration(overrides: string[] = []): string {
  return [
    "```yaml",
    "content_product_impact:",
    "  lane: contract_fulfillment",
    "  features:",
    "    - content.feature.test",
    "  capabilities:",
    "    - content.test.alpha",
    "  record_change: included",
    "  proof:",
    "    - pnpm test:content-product-impact",
    "  rationale: The fixture changes the declared Content contract.",
    ...overrides,
    "```",
  ].join("\n");
}

before(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), "content-impact-test-"));
  baseRoot = path.join(temporaryRoot, "base");
  headRoot = path.join(temporaryRoot, "head");
  cpSync(fixture, baseRoot, { recursive: true });
  cpSync(fixture, headRoot, { recursive: true });

  const feature = path.join(headRoot, "features/content.feature.test.md");
  writeFileSync(
    feature,
    readFileSync(feature, "utf8").replace(
      'roadmap_status: "planned"',
      'roadmap_status: "in_validation"',
    ),
  );
  const capability = path.join(headRoot, "capabilities/content.test.alpha.md");
  writeFileSync(
    capability,
    readFileSync(capability, "utf8").replace(
      'state: "approved_shape"',
      'state: "in_progress"',
    ),
  );
});

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

describe("Content impact declaration", () => {
  it("parses one complete declaration", () => {
    const result = parseContentImpactDeclaration(declaration());
    assert.equal(result.status, "valid");
    if (result.status !== "valid") return;
    assert.deepEqual(result.declaration.features, ["content.feature.test"]);
    assert.deepEqual(result.declaration.capabilities, ["content.test.alpha"]);
  });

  it("distinguishes missing, duplicate, malformed, and unknown-key blocks", () => {
    assert.equal(
      parseContentImpactDeclaration("No impact block.").status,
      "missing",
    );
    assert.equal(
      parseContentImpactDeclaration(`${declaration()}\n${declaration()}`)
        .status,
      "duplicate",
    );
    assert.equal(
      parseContentImpactDeclaration(
        "```yaml\ncontent_product_impact: [unterminated\n```",
      ).status,
      "malformed",
    );
    const unknown = parseContentImpactDeclaration(
      declaration(["  surprise: no"]),
    );
    assert.equal(unknown.status, "malformed");
    if (unknown.status === "malformed") {
      assert(unknown.errors.some((error) => error.includes("unknown field")));
    }
    const sibling = parseContentImpactDeclaration(
      declaration(["unrelated_top_level_key: true"]),
    );
    assert.equal(sibling.status, "malformed");
  });

  it("requires exact IDs except for a pending product decision", () => {
    const emptyFulfillment = parseContentImpactDeclaration(
      declaration()
        .replace("    - content.feature.test\n", "    []\n")
        .replace("    - content.test.alpha\n", "    []\n"),
    );
    assert.equal(emptyFulfillment.status, "malformed");

    const pendingDecision = parseContentImpactDeclaration(
      declaration()
        .replace("contract_fulfillment", "product_decision_candidate")
        .replace("    - content.feature.test\n", "    []\n")
        .replace("    - content.test.alpha\n", "    []\n")
        .replace("record_change: included", "record_change: decision_pending"),
    );
    assert.equal(pendingDecision.status, "valid");

    const includedNewRecord = parseContentImpactDeclaration(
      declaration()
        .replace("contract_fulfillment", "product_decision_candidate")
        .replace("    - content.feature.test\n", "    []\n")
        .replace("    - content.test.alpha\n", "    []\n"),
    );
    assert.equal(includedNewRecord.status, "valid");
  });
});

describe("Content impact applicability", () => {
  it("automatically includes direct Content surfaces and exact conformance policy", () => {
    assert(directContentEvidence("templates/content/app/routes/home.tsx"));
    assert(
      directContentEvidence("templates/content/actions/create-document.ts"),
    );
    assert(directContentEvidence("templates/content/docs/product/roadmap.md"));
    assert(directContentEvidence("templates/content/parity/contract.test.ts"));
    assert(directContentEvidence("templates/content/vite.config.ts"));
    assert(directContentEvidence("templates/content/tsconfig.json"));
    assert(directContentEvidence("templates/content/vitest.config.ts"));
    assert(directContentEvidence("templates/content/drizzle/0001_example.sql"));
    assert(directContentEvidence("templates/content/public/example.svg"));
    assert.equal(
      directContentEvidence("templates/content/README.md"),
      undefined,
    );
    assert.equal(
      directContentEvidence("templates/content/.oxfmtrc.json"),
      undefined,
    );
    assert.equal(
      directContentEvidence("scripts/validate-content-product-impact.ts"),
      undefined,
    );
    assert.equal(
      directContentEvidence(
        ".github/workflows/content-product-conformance.yml",
      ),
      undefined,
    );
  });

  it("keeps ordinary shared framework, CI, dependency, and infrastructure changes quiet", () => {
    for (const file of [
      "packages/core/src/client/index.ts",
      "packages/toolkit/src/index.ts",
      ".github/workflows/ci.yml",
      "pnpm-lock.yaml",
      "infra/example.tf",
    ]) {
      assert.equal(directContentEvidence(file), undefined, file);
    }
  });
});

describe("Content impact analysis", () => {
  const changedFiles = [
    "templates/content/docs/product/features/content.feature.test.md",
    "templates/content/docs/product/capabilities/content.test.alpha.md",
  ];

  function catalogs() {
    return {
      base: validateContentProductDocs(baseRoot, {
        strictCatalog: false,
        checkProjections: false,
      }),
      head: validateContentProductDocs(headRoot, {
        strictCatalog: false,
        checkProjections: false,
      }),
    };
  }

  it("reports deterministic Feature and Capability transitions", () => {
    const { base, head } = catalogs();
    const result = collectTransitions(changedFiles, base.catalog, head.catalog);
    assert.deepEqual(result.changedRecords, [
      "content.feature.test",
      "content.test.alpha",
    ]);
    assert.deepEqual(result.transitions, [
      {
        id: "content.feature.test",
        kind: "feature",
        from: "planned",
        to: "in_validation",
      },
      {
        id: "content.test.alpha",
        kind: "capability",
        from: "approved_shape",
        to: "in_progress",
      },
    ]);
  });

  it("accepts a complete applicable declaration without deterministic findings", () => {
    const { base, head } = catalogs();
    const result = analyzeContentProductImpact({
      body: declaration(),
      changedFiles,
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
      baseCatalogErrors: base.errors,
      headCatalogErrors: head.errors,
    });
    assert.equal(result.applicable, true);
    assert.deepEqual(result.findings, []);
  });

  it("warns for missing declarations, unknown IDs, and undeclared record changes", () => {
    const { base, head } = catalogs();
    const missing = analyzeContentProductImpact({
      body: "",
      changedFiles,
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
    });
    assert(
      missing.findings.some((item) => item.code === "declaration-missing"),
    );

    const invalid = analyzeContentProductImpact({
      body: declaration().replace(
        "content.test.alpha",
        "content.missing.capability",
      ),
      changedFiles,
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
    });
    assert(invalid.findings.some((item) => item.code === "unknown-capability"));
    assert(
      invalid.findings.some(
        (item) => item.code === "changed-record-undeclared",
      ),
    );
  });

  it("lets a valid explicit declaration opt a shared-only PR into conformance", () => {
    const { base, head } = catalogs();
    const result = analyzeContentProductImpact({
      body: declaration()
        .replace("    - content.feature.test\n", "    []\n")
        .replace("record_change: included", "record_change: none"),
      changedFiles: ["packages/core/src/client/index.ts"],
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
    });
    assert.equal(result.applicable, true);
    assert.deepEqual(result.findings, []);
  });

  it("keeps a shared-only PR with no direct evidence quiet and non-notifying", () => {
    const { base, head } = catalogs();
    const result = analyzeContentProductImpact({
      body: "",
      changedFiles: ["packages/core/src/client/index.ts"],
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
    });
    assert.equal(result.applicable, false);
    assert.deepEqual(result.findings, []);
  });

  it("keeps malformed and unknown-ID declarations quiet on shared-only PRs", () => {
    const { base, head } = catalogs();
    for (const body of [
      "```yaml\ncontent_product_impact: [broken\n```",
      declaration()
        .replace("    - content.feature.test\n", "    []\n")
        .replace("content.test.alpha", "content.unknown.contract"),
    ]) {
      const result = analyzeContentProductImpact({
        body,
        changedFiles: ["packages/core/src/client/index.ts"],
        baseCatalog: base.catalog,
        headCatalog: head.catalog,
      });
      assert.equal(result.applicable, false);
      assert.deepEqual(result.findings, []);
    }
  });
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createCliRepository(
  name: string,
  change: (root: string) => void,
  body: string,
  withCatalog = true,
  prepareBase?: (root: string) => void,
) {
  const root = path.join(temporaryRoot, name);
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "content-conformance@example.invalid"]);
  git(root, ["config", "user.name", "Content Conformance Test"]);
  if (withCatalog) {
    const productRoot = path.join(root, "templates/content/docs/product");
    const skillRoot = path.join(
      root,
      "templates/content/.agents/skills/content-product-development",
    );
    mkdirSync(productRoot, { recursive: true });
    mkdirSync(skillRoot, { recursive: true });
    cpSync(path.join(repositoryRoot, fixture), productRoot, {
      recursive: true,
    });
    writeFileSync(
      path.join(productRoot, "architecture.md"),
      "# Architecture\n",
    );
    writeFileSync(
      path.join(productRoot, "README.md"),
      "Read the [architecture](architecture.md).\n",
    );
    writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      "# Content product skill\n",
    );
  } else {
    writeFileSync(path.join(root, "README.md"), "base\n");
  }
  prepareBase?.(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const baseSha = git(root, ["rev-parse", "HEAD"]);
  change(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "head"]);
  const headSha = git(root, ["rev-parse", "HEAD"]);
  const eventPath = path.join(temporaryRoot, `${name}-event.json`);
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        body,
        base: { sha: baseSha },
        head: { sha: headSha },
      },
    }),
  );
  return { root, eventPath, baseSha, headSha };
}

function runCli(input: ReturnType<typeof createCliRepository>) {
  return spawnSync(tsxPath, [checkerPath], {
    cwd: input.root,
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: input.eventPath,
      CONTENT_IMPACT_BASE_SHA: input.baseSha,
      CONTENT_IMPACT_HEAD_SHA: input.headSha,
    },
    encoding: "utf8",
  });
}

describe("Content impact CLI boundary", () => {
  it("returns success for advisory findings and emits a copyable warning", () => {
    const repository = createCliRepository(
      "direct-cli",
      (root) => {
        const file = path.join(root, "templates/content/app/example.ts");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "export const example = true;\n");
      },
      "",
    );
    const result = runCli(repository);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"advisory":true/);
    assert.match(result.stdout, /::warning title=Content product impact/);
    assert.match(result.stdout, /content_product_impact/);
  });

  it("does not notify for a malformed declaration on a shared-only change", () => {
    const repository = createCliRepository(
      "shared-cli",
      (root) => {
        const file = path.join(root, "packages/core/src/example.ts");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "export const example = true;\n");
      },
      "```yaml\ncontent_product_impact: [broken\n```",
    );
    const result = runCli(repository);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Not applicable/);
    assert.doesNotMatch(result.stdout, /::warning/);
  });

  it("validates the base and head developer skills from their own revisions", () => {
    const repository = createCliRepository(
      "head-skill-cli",
      (root) => {
        writeFileSync(
          path.join(
            root,
            "templates/content/.agents/skills/content-product-development/SKILL.md",
          ),
          "# Content product skill\n\nDo not use [live checkout files](../../../../../../../package.json).\n",
        );
      },
      "",
    );
    const result = runCli(repository);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /head-catalog-invalid/);
    assert.match(result.stdout, /link escapes the repository/);
    assert.doesNotMatch(result.stderr, /base Content product catalog/);
  });

  it("materializes linked non-Markdown files inside each snapshot", () => {
    const repository = createCliRepository(
      "linked-asset-cli",
      (root) => {
        const file = path.join(root, "templates/content/app/example.ts");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "export const example = true;\n");
      },
      "",
      true,
      (root) => {
        const productRoot = path.join(root, "templates/content/docs/product");
        writeFileSync(path.join(productRoot, "contract.json"), "{}\n");
        writeFileSync(
          path.join(productRoot, "README.md"),
          "Read the [architecture](architecture.md) and [contract](contract.json).\n",
        );
      },
    );
    const result = runCli(repository);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /broken relative link/);
  });

  it("uses the merge-base for a PR whose target branch has advanced", () => {
    const repository = createCliRepository(
      "diverged-base-cli",
      (root) => writeFileSync(path.join(root, "README.md"), "head\n"),
      declaration().replace("record_change: included", "record_change: none"),
    );
    git(repository.root, ["checkout", "-q", "--detach", repository.baseSha]);
    writeFileSync(
      path.join(
        repository.root,
        "templates/content/.agents/skills/content-product-development/SKILL.md",
      ),
      "# Content product skill\n\nDo not use file:///private/example.\n",
    );
    git(repository.root, ["add", "."]);
    git(repository.root, ["commit", "-qm", "advanced base"]);
    const advancedBaseSha = git(repository.root, ["rev-parse", "HEAD"]);
    writeFileSync(
      repository.eventPath,
      JSON.stringify({
        pull_request: {
          body: declaration().replace(
            "record_change: included",
            "record_change: none",
          ),
          base: { sha: advancedBaseSha },
          head: { sha: repository.headSha },
        },
      }),
    );

    const result = runCli({ ...repository, baseSha: advancedBaseSha });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /base Content product catalog/);
    assert.match(
      result.stdout,
      new RegExp(`"comparisonBaseSha":"${repository.baseSha}"`),
    );
  });

  it("fails loudly for mismatched event revisions and missing catalogs", () => {
    const mismatch = createCliRepository(
      "mismatch-cli",
      (root) => writeFileSync(path.join(root, "README.md"), "head\n"),
      "",
      false,
    );
    const mismatchEvent = JSON.parse(readFileSync(mismatch.eventPath, "utf8"));
    mismatchEvent.pull_request.base.sha = mismatch.headSha;
    writeFileSync(mismatch.eventPath, JSON.stringify(mismatchEvent));
    const mismatchResult = runCli(mismatch);
    assert.notEqual(mismatchResult.status, 0);
    assert.match(mismatchResult.stderr, /do not match/);

    const missingCatalog = createCliRepository(
      "missing-catalog-cli",
      (root) => writeFileSync(path.join(root, "README.md"), "head\n"),
      "",
      false,
    );
    const missingResult = runCli(missingCatalog);
    assert.notEqual(missingResult.status, 0);
    assert.match(missingResult.stderr, /readable Content product records/);

    const nestedCatalog = createCliRepository(
      "nested-catalog-cli",
      (root) => {
        const productRoot = path.join(root, "templates/content/docs/product");
        for (const directory of ["chapters", "features", "capabilities"]) {
          rmSync(path.join(productRoot, directory), {
            recursive: true,
            force: true,
          });
        }
        const archive = path.join(productRoot, "archive/capabilities");
        mkdirSync(archive, { recursive: true });
        writeFileSync(path.join(archive, "note.md"), "# Not a record\n");
      },
      "",
    );
    const nestedResult = runCli(nestedCatalog);
    assert.notEqual(nestedResult.status, 0);
    assert.match(nestedResult.stderr, /readable Content product records/);

    const invalidBase = createCliRepository(
      "invalid-base-cli",
      (root) => writeFileSync(path.join(root, "README.md"), "head\n"),
      "",
      true,
      (root) => {
        writeFileSync(path.join(root, "README.md"), "base\n");
        const feature = path.join(
          root,
          "templates/content/docs/product/features/content.feature.test.md",
        );
        writeFileSync(
          feature,
          readFileSync(feature, "utf8").replace("---", ""),
        );
      },
    );
    const invalidResult = runCli(invalidBase);
    assert.notEqual(invalidResult.status, 0);
    assert.match(invalidResult.stderr, /base Content product catalog/);
  });
});
