#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  type ProductCatalog,
  type ProductRecord,
  validateContentProductDocs,
} from "./validate-content-product-docs.ts";

const PRODUCT_ROOT = "templates/content/docs/product";
const CONTENT_PRODUCT_SKILL_ROOT =
  "templates/content/.agents/skills/content-product-development";
const CHECKER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_REPOSITORY_ROOT = path.resolve(
  process.cwd(),
  process.env.CONTENT_IMPACT_REPOSITORY ?? ".",
);
const LANES = [
  "contract_repair",
  "contract_fulfillment",
  "local_refinement",
  "product_decision_candidate",
] as const;
const RECORD_CHANGES = ["none", "included", "decision_pending"] as const;
const DECLARATION_KEYS = new Set([
  "lane",
  "features",
  "capabilities",
  "record_change",
  "proof",
  "rationale",
]);
const DECLARATION_REPAIR = `\`\`\`yaml
content_product_impact:
  lane: contract_repair
  features:
    - content.feature.see-your-information-your-way
  capabilities:
    - content.view.renderer-conformance
  record_change: none
  proof:
    - focused test or acceptance artifact
  rationale: Explain the exact Content impact and record obligation.
\`\`\``;

export type ContentImpactLane = (typeof LANES)[number];
export type RecordChange = (typeof RECORD_CHANGES)[number];

export type ContentImpactDeclaration = {
  lane: ContentImpactLane;
  features: string[];
  capabilities: string[];
  record_change: RecordChange;
  proof: string[];
  rationale: string;
};

export type DeclarationResult =
  | { status: "missing" }
  | { status: "malformed"; errors: string[] }
  | { status: "duplicate"; errors: string[] }
  | { status: "valid"; declaration: ContentImpactDeclaration };

export type ProductTransition = {
  id: string;
  kind: "feature" | "capability";
  from: string | null;
  to: string | null;
};

export type ImpactFinding = {
  code: string;
  message: string;
};

export type ImpactAnalysis = {
  applicable: boolean;
  applicabilityReasons: string[];
  declaration: DeclarationResult;
  changedRecords: string[];
  transitions: ProductTransition[];
  findings: ImpactFinding[];
};

export type ImpactAnalysisInput = {
  body: string;
  changedFiles: readonly string[];
  baseCatalog: ProductCatalog;
  headCatalog: ProductCatalog;
  baseCatalogErrors?: readonly string[];
  headCatalogErrors?: readonly string[];
};

type PullRequestEvent = {
  pull_request?: {
    body?: string | null;
    base?: { sha?: string };
    head?: { sha?: string };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(
  value: unknown,
  field: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${field} must be an array of strings`);
    return [];
  }
  return value.map((item) => item.trim());
}

function parseDeclarationValue(
  value: unknown,
):
  | { declaration: ContentImpactDeclaration; errors: [] }
  | { declaration?: undefined; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value) || !isRecord(value.content_product_impact)) {
    return {
      errors: ["content_product_impact must be a YAML mapping"],
    };
  }
  const topLevelKeys = Object.keys(value);
  if (
    topLevelKeys.length !== 1 ||
    topLevelKeys[0] !== "content_product_impact"
  ) {
    errors.push("declaration block must contain only content_product_impact");
  }
  const impact = value.content_product_impact;
  for (const key of Object.keys(impact)) {
    if (!DECLARATION_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }

  const lane =
    typeof impact.lane === "string" ? impact.lane.trim() : impact.lane;
  if (typeof lane !== "string" || !LANES.includes(lane as ContentImpactLane)) {
    errors.push(`lane must be one of: ${LANES.join(", ")}`);
  }
  const recordChange =
    typeof impact.record_change === "string"
      ? impact.record_change.trim()
      : impact.record_change;
  if (
    typeof recordChange !== "string" ||
    !RECORD_CHANGES.includes(recordChange as RecordChange)
  ) {
    errors.push(`record_change must be one of: ${RECORD_CHANGES.join(", ")}`);
  }
  const features = stringArray(impact.features, "features", errors);
  const capabilities = stringArray(impact.capabilities, "capabilities", errors);
  const proof = stringArray(impact.proof, "proof", errors);
  if (proof.length === 0) errors.push("proof must contain at least one entry");
  if (proof.some((item) => item.trim().length === 0)) {
    errors.push("proof entries must not be empty");
  }
  const rationale =
    typeof impact.rationale === "string"
      ? impact.rationale.trim()
      : impact.rationale;
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    errors.push("rationale must be a non-empty string");
  }
  if (
    typeof lane === "string" &&
    lane !== "product_decision_candidate" &&
    features.length + capabilities.length === 0
  ) {
    errors.push(`${lane} requires at least one Feature or Capability ID`);
  }
  if (
    lane === "product_decision_candidate" &&
    features.length + capabilities.length === 0 &&
    recordChange !== "decision_pending" &&
    recordChange !== "included"
  ) {
    errors.push(
      "a product_decision_candidate without IDs requires record_change decision_pending or included",
    );
  }
  for (const [field, ids] of [
    ["features", features],
    ["capabilities", capabilities],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      errors.push(`${field} must not contain duplicate IDs`);
    }
  }
  if (errors.length > 0) return { errors };

  return {
    errors: [],
    declaration: {
      lane: lane as ContentImpactLane,
      features,
      capabilities,
      record_change: recordChange as RecordChange,
      proof,
      rationale: rationale as string,
    },
  };
}

export function parseContentImpactDeclaration(body: string): DeclarationResult {
  const candidates = [
    ...body.matchAll(/```(?:yaml|yml)\s*\r?\n([\s\S]*?)```/gi),
  ]
    .map((match) => match[1])
    .filter((source) => /^\s*content_product_impact\s*:/m.test(source));

  if (candidates.length === 0) return { status: "missing" };
  if (candidates.length > 1) {
    return {
      status: "duplicate",
      errors: ["PR body must contain exactly one content_product_impact block"],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(candidates[0], { uniqueKeys: true });
  } catch (error) {
    return {
      status: "malformed",
      errors: [
        `declaration YAML could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const result = parseDeclarationValue(parsed);
  return result.declaration
    ? { status: "valid", declaration: result.declaration }
    : { status: "malformed", errors: result.errors };
}

const CONTENT_ROOT_EXCLUSIONS = new Set([
  "templates/content/.dockerignore",
  "templates/content/.gitignore",
  "templates/content/.ignore",
  "templates/content/.oxfmtrc.json",
  "templates/content/CHANGELOG.md",
  "templates/content/DEVELOPING.md",
  "templates/content/README.md",
  "templates/content/_gitignore",
]);

export function directContentEvidence(file: string): string | undefined {
  const normalized = file.replaceAll("\\", "/");
  const prefixes = [
    "templates/content/actions/",
    "templates/content/app/",
    "templates/content/data/",
    "templates/content/docs/product/",
    "templates/content/drizzle/",
    "templates/content/e2e/",
    "templates/content/parity/",
    "templates/content/public/",
    "templates/content/scripts/",
    "templates/content/server/",
    "templates/content/shared/",
    "templates/content/.agents/skills/content-product-development/",
    "scripts/fixtures/content-product-docs/",
    "scripts/fixtures/content-product-impact/",
  ];
  if (prefixes.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }
  if (
    /^templates\/content\/[^/]+$/.test(normalized) &&
    !CONTENT_ROOT_EXCLUSIONS.has(normalized)
  ) {
    return normalized;
  }
  if (
    normalized.startsWith("templates/content/") &&
    /(?:content.*parity|parity.*content|content.*conformance|conformance.*content)/i.test(
      normalized,
    )
  ) {
    return normalized;
  }
  return undefined;
}

function stateOf(record: ProductRecord): string | null {
  const value =
    record.kind === "feature" ? record.data.roadmap_status : record.data.state;
  return typeof value === "string" ? value : null;
}

export function collectTransitions(
  changedFiles: readonly string[],
  baseCatalog: ProductCatalog,
  headCatalog: ProductCatalog,
): { changedRecords: string[]; transitions: ProductTransition[] } {
  const recordIds = new Set<string>();
  const productRecordPath = new RegExp(
    `^${PRODUCT_ROOT}/(?:features|capabilities)/(content\\.[a-z0-9.-]+)\\.md$`,
  );
  for (const file of changedFiles) {
    const match = file.match(productRecordPath);
    if (match) recordIds.add(match[1]);
  }

  const baseById = new Map(
    baseCatalog.records.map((record) => [record.id, record]),
  );
  const headById = new Map(
    headCatalog.records.map((record) => [record.id, record]),
  );
  const transitions: ProductTransition[] = [];
  for (const id of [...recordIds].sort()) {
    const base = baseById.get(id);
    const head = headById.get(id);
    const record = head ?? base;
    if (!record || record.kind === "chapter") continue;
    const from = base ? stateOf(base) : null;
    const to = head ? stateOf(head) : null;
    if (from !== to) transitions.push({ id, kind: record.kind, from, to });
  }
  return { changedRecords: [...recordIds].sort(), transitions };
}

function finding(code: string, message: string): ImpactFinding {
  return { code, message };
}

export function analyzeContentProductImpact(
  input: ImpactAnalysisInput,
): ImpactAnalysis {
  const declaration = parseContentImpactDeclaration(input.body);
  const direct = input.changedFiles
    .map(directContentEvidence)
    .filter((file): file is string => file !== undefined);
  const headIntroducedCatalogFailure =
    (input.baseCatalogErrors?.length ?? 0) === 0 &&
    (input.headCatalogErrors?.length ?? 0) > 0;
  const knownFeatureIds = new Set(
    input.headCatalog.features.map((record) => record.id),
  );
  const knownCapabilityIds = new Set(
    input.headCatalog.capabilities.map((record) => record.id),
  );
  const declarationNamesKnownId =
    declaration.status === "valid" &&
    (declaration.declaration.features.some((id) => knownFeatureIds.has(id)) ||
      declaration.declaration.capabilities.some((id) =>
        knownCapabilityIds.has(id),
      ));
  const applicabilityReasons = [
    ...direct.map((file) => `direct:${file}`),
    ...(declarationNamesKnownId ? ["declaration"] : []),
    ...(headIntroducedCatalogFailure ? ["content-contract-failure"] : []),
  ];
  const applicable = applicabilityReasons.length > 0;
  const { changedRecords, transitions } = collectTransitions(
    input.changedFiles,
    input.baseCatalog,
    input.headCatalog,
  );
  const findings: ImpactFinding[] = [];

  if (!applicable) {
    return {
      applicable,
      applicabilityReasons,
      declaration,
      changedRecords,
      transitions,
      findings,
    };
  }

  if (declaration.status === "missing") {
    findings.push(
      finding(
        "declaration-missing",
        `Copy this declaration into the PR body and replace its values with the exact impact:\n${DECLARATION_REPAIR}`,
      ),
    );
  } else if (declaration.status !== "valid") {
    for (const error of declaration.errors) {
      findings.push(finding(`declaration-${declaration.status}`, error));
    }
  } else {
    const value = declaration.declaration;
    const headFeatures = new Set(
      input.headCatalog.features.map((record) => record.id),
    );
    const headCapabilities = new Set(
      input.headCatalog.capabilities.map((record) => record.id),
    );
    const deletedFeatures = new Set(
      input.baseCatalog.records
        .filter(
          (record) =>
            record.kind === "feature" &&
            changedRecords.includes(record.id) &&
            !input.headCatalog.records.some((head) => head.id === record.id),
        )
        .map((record) => record.id),
    );
    const deletedCapabilities = new Set(
      input.baseCatalog.records
        .filter(
          (record) =>
            record.kind === "capability" &&
            changedRecords.includes(record.id) &&
            !input.headCatalog.records.some((head) => head.id === record.id),
        )
        .map((record) => record.id),
    );

    for (const id of value.features) {
      if (!headFeatures.has(id) && !deletedFeatures.has(id)) {
        findings.push(finding("unknown-feature", `Unknown Feature ID: ${id}`));
      }
    }
    for (const id of value.capabilities) {
      if (!headCapabilities.has(id) && !deletedCapabilities.has(id)) {
        findings.push(
          finding("unknown-capability", `Unknown Capability ID: ${id}`),
        );
      }
    }

    const declaredIds = new Set([...value.features, ...value.capabilities]);
    const allowsUnnamedNewRecords =
      value.lane === "product_decision_candidate" &&
      value.record_change === "included" &&
      declaredIds.size === 0;
    for (const id of changedRecords) {
      const recordExistedAtBase = input.baseCatalog.records.some(
        (record) => record.id === id,
      );
      if (
        !declaredIds.has(id) &&
        !(allowsUnnamedNewRecords && !recordExistedAtBase)
      ) {
        findings.push(
          finding(
            "changed-record-undeclared",
            `Changed product record ${id} is not named in the declaration.`,
          ),
        );
      }
    }
    if (changedRecords.length > 0 && value.record_change === "none") {
      findings.push(
        finding(
          "record-change-mismatch",
          "record_change cannot be none when Feature or Capability records changed.",
        ),
      );
    }
    if (changedRecords.length === 0 && value.record_change === "included") {
      findings.push(
        finding(
          "record-change-mismatch",
          "record_change is included, but no Feature or Capability record changed.",
        ),
      );
    }
    if (
      value.record_change === "decision_pending" &&
      value.lane !== "product_decision_candidate"
    ) {
      findings.push(
        finding(
          "decision-lane-mismatch",
          "record_change decision_pending requires lane product_decision_candidate.",
        ),
      );
    }
    if (
      value.record_change === "decision_pending" &&
      transitions.some(
        (transition) =>
          transition.to === "verified" || transition.to === "available",
      )
    ) {
      findings.push(
        finding(
          "decision-promotion-mismatch",
          "record_change decision_pending cannot claim a verified Capability or available Feature promotion.",
        ),
      );
    }
  }

  for (const error of input.headCatalogErrors ?? []) {
    findings.push(finding("head-catalog-invalid", error));
  }

  return {
    applicable,
    applicabilityReasons,
    declaration,
    changedRecords,
    transitions,
    findings,
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: SOURCE_REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function gitFile(sha: string, file: string): Buffer {
  return execFileSync("git", ["show", `${sha}:${file}`], {
    cwd: SOURCE_REPOSITORY_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function assertSha(value: string, name: string): void {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Error(`${name} must be a full Git object SHA`);
  }
  git(["cat-file", "-e", `${value}^{commit}`]);
}

function materializeContentProductSnapshot(
  sha: string,
  destination: string,
): string {
  const root = path.join(destination, PRODUCT_ROOT);
  for (const directory of ["chapters", "features", "capabilities"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  const output = git([
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    sha,
    "--",
    PRODUCT_ROOT,
    CONTENT_PRODUCT_SKILL_ROOT,
  ]);
  const files = output.split("\0").filter(Boolean);
  const productRecordFiles = files.filter(
    (file) =>
      file.endsWith(".md") &&
      new RegExp(
        `^${PRODUCT_ROOT}/(?:chapters|features|capabilities)/[^/]+\\.md$`,
      ).test(file),
  );
  if (productRecordFiles.length === 0) {
    throw new Error(`${sha} does not contain readable Content product records`);
  }
  for (const file of files) {
    const destinationFile = path.join(destination, file);
    mkdirSync(path.dirname(destinationFile), { recursive: true });
    writeFileSync(destinationFile, gitFile(sha, file));
  }
  return root;
}

function changedFiles(baseSha: string, headSha: string): string[] {
  return git([
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--diff-filter=ACDMRTUXB",
    baseSha,
    headSha,
  ])
    .split("\0")
    .filter(Boolean);
}

function annotationEscape(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

export function renderImpactSummary(analysis: ImpactAnalysis): string {
  if (!analysis.applicable) {
    return [
      "## Content product conformance",
      "",
      "Not applicable. No direct Content evidence or explicit Content impact declaration was found.",
    ].join("\n");
  }
  const lines = [
    "## Content product conformance — advisory pilot",
    "",
    `Applicability: ${analysis.applicabilityReasons.join(", ")}`,
    `Declaration: ${analysis.declaration.status}`,
    `Changed Feature/Capability records: ${analysis.changedRecords.join(", ") || "none"}`,
    "",
  ];
  if (analysis.transitions.length > 0) {
    lines.push("| record | transition |", "| --- | --- |");
    for (const transition of analysis.transitions) {
      lines.push(
        `| ${transition.id} | ${transition.from ?? "absent"} -> ${transition.to ?? "absent"} |`,
      );
    }
    lines.push("");
  }
  if (analysis.findings.length === 0) {
    lines.push("No deterministic findings. This pilot remains advisory.");
  } else {
    lines.push("### Advisory findings", "");
    for (const item of analysis.findings) {
      lines.push(`- **${item.code}:** ${item.message}`);
    }
    lines.push(
      "",
      "These findings do not block the pull request during calibration.",
    );
  }
  return lines.join("\n");
}

export function runContentProductImpactCheck(): void {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const baseSha = process.env.CONTENT_IMPACT_BASE_SHA;
  const headSha = process.env.CONTENT_IMPACT_HEAD_SHA;
  if (!eventPath || !baseSha || !headSha) {
    throw new Error(
      "GITHUB_EVENT_PATH, CONTENT_IMPACT_BASE_SHA, and CONTENT_IMPACT_HEAD_SHA are required",
    );
  }
  assertSha(baseSha, "CONTENT_IMPACT_BASE_SHA");
  assertSha(headSha, "CONTENT_IMPACT_HEAD_SHA");

  const event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error("event does not contain pull_request data");
  if (pullRequest.base?.sha !== baseSha || pullRequest.head?.sha !== headSha) {
    throw new Error(
      "event base/head SHAs do not match the requested revisions",
    );
  }
  const comparisonBaseSha = git(["merge-base", baseSha, headSha]).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(comparisonBaseSha)) {
    throw new Error("could not resolve a full merge-base for the PR revisions");
  }

  const temporaryRoot = mkdtempSync(
    path.join(CHECKER_ROOT, ".content-impact-"),
  );
  try {
    const baseSnapshotRoot = path.join(temporaryRoot, "base");
    const headSnapshotRoot = path.join(temporaryRoot, "head");
    const baseRoot = materializeContentProductSnapshot(
      comparisonBaseSha,
      baseSnapshotRoot,
    );
    const headRoot = materializeContentProductSnapshot(
      headSha,
      headSnapshotRoot,
    );
    const base = validateContentProductDocs(baseRoot, {
      strictCatalog: false,
      checkProjections: false,
      validationRoot: baseSnapshotRoot,
    });
    const head = validateContentProductDocs(headRoot, {
      strictCatalog: false,
      checkProjections: false,
      validationRoot: headSnapshotRoot,
    });
    if (base.errors.length > 0) {
      throw new Error(
        `base Content product catalog is unreadable or invalid:\n${base.errors.join("\n")}`,
      );
    }
    const analysis = analyzeContentProductImpact({
      body: pullRequest.body ?? "",
      changedFiles: changedFiles(comparisonBaseSha, headSha),
      baseCatalog: base.catalog,
      headCatalog: head.catalog,
      baseCatalogErrors: base.errors,
      headCatalogErrors: head.errors,
    });
    const summary = renderImpactSummary(analysis);
    process.stdout.write(
      `${JSON.stringify({
        schema: "content-conformance.advisory-declaration.v1",
        headSha,
        comparisonBaseSha,
        advisory: true,
        ...analysis,
      })}\n`,
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    process.stdout.write(`${summary}\n`);
    if (analysis.applicable) {
      for (const item of analysis.findings) {
        process.stdout.write(
          `::warning title=Content product impact (${annotationEscape(item.code)})::${annotationEscape(item.message)}\n`,
        );
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runContentProductImpactCheck();
  } catch (error) {
    console.error(
      `Content product impact check could not establish its inputs: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
