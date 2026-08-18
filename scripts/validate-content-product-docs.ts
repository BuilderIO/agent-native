import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultProductRoot = join(
  repositoryRoot,
  "templates/content/docs/product",
);

const roadmapStatuses = new Set([
  "available",
  "in_validation",
  "partially_implemented",
  "planned",
  "paused",
]);
const capabilityStates = new Set([
  "verified",
  "failing",
  "stale",
  "in_progress",
  "approved_shape",
  "exploring",
  "deferred",
  "superseded",
]);
const capabilityKinds = new Set(["primitive", "surface", "workflow"]);
const publicnessValues = new Set(["public", "internal"]);
const availabilityValues = new Set([
  "universal",
  "configured",
  "desktop",
  "external_host",
  "organization",
  "development",
]);
const roadmapBoundaries = new Set([
  "feature",
  "supporting",
  "deferred",
  "superseded",
]);

export type RecordKind = "chapter" | "feature" | "capability";

export type ProductRecord = {
  file: string;
  body: string;
  data: Record<string, unknown>;
  kind: RecordKind;
  id: string;
};

export type ProductCatalog = {
  root: string;
  chapters: ProductRecord[];
  features: ProductRecord[];
  capabilities: ProductRecord[];
  records: ProductRecord[];
};

export type ValidationResult = {
  catalog: ProductCatalog;
  errors: string[];
  roadmap: string;
  encyclopedia: string;
};

export function validateContentProductDocs(
  root = defaultProductRoot,
  options: {
    strictCatalog?: boolean;
    checkProjections?: boolean;
    validationRoot?: string;
  } = {},
): ValidationResult {
  const strictCatalog = options.strictCatalog ?? root === defaultProductRoot;
  const checkProjections = options.checkProjections ?? true;
  const errors: string[] = [];
  const catalog = loadCatalog(root, errors);

  validateCatalog(catalog, errors, strictCatalog);
  validateLinksAndPrivacy(
    catalog,
    errors,
    options.validationRoot ?? repositoryRoot,
  );

  const roadmap = renderRoadmap(catalog);
  const encyclopedia = renderEncyclopedia(catalog);

  if (checkProjections) {
    compareProjection(join(root, "roadmap.md"), roadmap, errors);
    compareProjection(join(root, "encyclopedia.md"), encyclopedia, errors);
  }

  return { catalog, errors, roadmap, encyclopedia };
}

export function writeContentProductProjections(root = defaultProductRoot) {
  const result = validateContentProductDocs(root, { checkProjections: false });
  if (result.errors.length > 0) throw new Error(formatErrors(result.errors));
  writeFileSync(join(root, "roadmap.md"), result.roadmap);
  writeFileSync(join(root, "encyclopedia.md"), result.encyclopedia);
}

export function renderRoadmap(catalog: ProductCatalog) {
  const chapterById = new Map(
    catalog.chapters.map((record) => [record.id, record]),
  );
  const capabilityById = new Map(
    catalog.capabilities.map((record) => [record.id, record]),
  );
  const chapters = [...catalog.chapters].sort(
    (left, right) => numberField(left, "order") - numberField(right, "order"),
  );

  const lines = [
    "# Agent Native Content public roadmap",
    "",
    generatedNotice(),
    "",
    "Agent Native Content brings documents, data, connected sources, collaboration, and agent work into one durable place. People and agents work on the same real objects through the same permissions and operations. The result is a workspace that can begin as a Page, grow into a system, and remain understandable, portable, and recoverable as more people and automations become involved.",
    "",
    "## How to read this roadmap",
    "",
    "Content is grouped into six implementation Chapters. Numbered Features describe complete vertical workflows that people can understand and use. Atomic capabilities may arrive piece by piece, but a Feature is not complete until its example workflow works end to end.",
    "",
    "Feature statuses:",
    "",
    "- **Available:** The complete workflow works for people and agents with the correct permissions, persistence, recovery, accessibility, and polish.",
    "- **In validation:** The complete workflow exists and is being hardened before becoming Available.",
    "- **Partially implemented:** Meaningful parts exist, but the workflow is not yet reliable or proven end to end.",
    "- **Planned:** The Feature is approved and ordered, but does not yet have enough implementation to describe as active.",
    "- **Paused:** Work deliberately stopped while its research and implementation history remain preserved.",
    "",
    "No Feature is marked Available yet. Existing foundations are useful, but the complete workflows still need the polish and proof described below.",
    "",
  ];

  for (const chapter of chapters) {
    const order = numberField(chapter, "order");
    lines.push(`## Chapter ${order}: ${stringField(chapter, "name")}`, "");
    lines.push(stringField(chapter, "promise"), "");

    const featureIds = stringArrayField(chapter, "features");
    for (const featureId of featureIds) {
      const feature = catalog.features.find(
        (record) => record.id === featureId,
      );
      if (!feature) continue;
      const number = numberField(feature, "number");
      lines.push(`### Feature ${number}: ${stringField(feature, "name")}`, "");
      lines.push(stringField(feature, "summary"), "");
      lines.push(
        `**Status:** ${displayRoadmapStatus(stringField(feature, "roadmap_status"))}`,
        "",
        `**Example workflow:** ${stringField(feature, "example_workflow")}`,
        "",
        `**What works today:** ${stringField(feature, "works_today")}`,
        "",
        `**What remains:** ${stringField(feature, "remains")}`,
        "",
      );

      const productContract = extractSection(
        feature.body,
        "## Product contract",
        "## Increment:",
      );
      lines.push("**What this Feature includes:**", "", productContract, "");

      const required = stringArrayField(feature, "required_capabilities");
      const enhancing = stringArrayField(feature, "enhancing_capabilities");
      lines.push(
        `**Required capability records:** ${renderCapabilityLinks(required, capabilityById)}`,
        "",
      );
      if (enhancing.length > 0) {
        lines.push(
          `**Enhancing capability records:** ${renderCapabilityLinks(enhancing, capabilityById)}`,
          "",
        );
      }

      const increment = extractIncrement(feature.body);
      if (increment) {
        lines.push(
          `### Increment to Feature ${number}: ${increment.name}`,
          "",
          increment.body,
          "",
        );
      }
    }
  }

  for (const feature of catalog.features) {
    if (!chapterById.has(stringField(feature, "chapter"))) continue;
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderEncyclopedia(catalog: ProductCatalog) {
  const capabilities = [...catalog.capabilities].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const stateCounts = new Map<string, number>();
  for (const capability of capabilities) {
    const state = stringField(capability, "state");
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
  }

  const lines = [
    "# Agent Native Content capability encyclopedia",
    "",
    generatedNotice(),
    "",
    "This index summarizes the atomic product contracts beneath the public roadmap. Each linked record owns its promise, dependencies, state, proof boundary, and relationship to complete Features.",
    "",
    "## Catalog summary",
    "",
    `- Chapters: ${catalog.chapters.length}`,
    `- Features: ${catalog.features.length}`,
    `- Named increments: ${catalog.features.reduce((total, feature) => total + stringArrayField(feature, "increments").length, 0)}`,
    `- Capabilities: ${capabilities.length}`,
    "",
  ];

  const stateRows = [["Capability state", "Count"]];
  for (const state of capabilityStates) {
    stateRows.push([
      displayCapabilityState(state),
      String(stateCounts.get(state) ?? 0),
    ]);
  }
  lines.push(...renderMarkdownTable(stateRows, ["left", "right"]));

  lines.push(
    "",
    "## Dependency overview",
    "",
    renderFamilyGraph(capabilities),
    "",
  );

  const families = new Map<string, ProductRecord[]>();
  for (const capability of capabilities) {
    const family = capability.id.split(".")[1] ?? "other";
    const entries = families.get(family) ?? [];
    entries.push(capability);
    families.set(family, entries);
  }

  for (const [family, records] of [...families].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`## ${displayCapabilityFamily(family)}`, "");
    const rows = [["Capability", "State", "User promise"]];
    for (const capability of records) {
      rows.push([
        `[${escapeTable(stringField(capability, "name"))}](capabilities/${capability.id}.md)`,
        displayCapabilityState(stringField(capability, "state")),
        escapeTable(stringField(capability, "user_promise")),
      ]);
    }
    lines.push(...renderMarkdownTable(rows));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function loadCatalog(root: string, errors: string[]): ProductCatalog {
  const records: ProductRecord[] = [];
  for (const kind of ["chapter", "feature", "capability"] as const) {
    const directory = join(
      root,
      kind === "capability" ? "capabilities" : `${kind}s`,
    );
    if (!existsSync(directory)) {
      errors.push(
        `${relative(repositoryRoot, directory)}: missing ${kind} directory`,
      );
      continue;
    }
    for (const filename of readdirSync(directory).filter((name) =>
      name.endsWith(".md"),
    )) {
      const file = join(directory, filename);
      try {
        const parsed = parseRecord(file);
        if (parsed.kind !== kind) {
          errors.push(
            `${displayPath(file)}: record_type must be ${kind}, found ${parsed.kind}`,
          );
        }
        records.push(parsed);
      } catch (error) {
        errors.push(
          `${displayPath(file)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    root,
    chapters: records.filter((record) => record.kind === "chapter"),
    features: records.filter((record) => record.kind === "feature"),
    capabilities: records.filter((record) => record.kind === "capability"),
    records,
  };
}

function parseRecord(file: string): ProductRecord {
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("expected YAML frontmatter between --- markers");
  const data = parseYaml(match[1]) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a mapping");
  }
  const kind = data.record_type;
  if (kind !== "chapter" && kind !== "feature" && kind !== "capability") {
    throw new Error(`record_type must be chapter, feature, or capability`);
  }
  if (typeof data.id !== "string") throw new Error("id must be a string");
  return { file, body: match[2].trim(), data, kind, id: data.id };
}

function validateCatalog(
  catalog: ProductCatalog,
  errors: string[],
  strictCatalog: boolean,
) {
  const recordsById = new Map<string, ProductRecord>();
  for (const record of catalog.records) {
    const expectedPattern =
      record.kind === "chapter"
        ? /^content\.chapter\.[a-z0-9-]+$/
        : record.kind === "feature"
          ? /^content\.feature\.[a-z0-9-]+$/
          : /^content\.[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
    if (!expectedPattern.test(record.id)) {
      errors.push(
        `${displayPath(record.file)}: id has an invalid ${record.kind} format`,
      );
    }
    if (recordsById.has(record.id)) {
      errors.push(
        `${displayPath(record.file)}: duplicate id ${record.id}; first declared in ${displayPath(recordsById.get(record.id)!.file)}`,
      );
    } else {
      recordsById.set(record.id, record);
    }
    const expectedFilename = `${record.id}.md`;
    if (!record.file.endsWith(`${sep}${expectedFilename}`)) {
      errors.push(
        `${displayPath(record.file)}: filename must be ${expectedFilename}`,
      );
    }
    requireString(record, "name", errors);
    requireEnum(record, "publicness", publicnessValues, errors);
    requireDate(record, "last_reviewed", errors);
    validateForbiddenFrontmatter(record, errors);
  }

  validateUniqueNumbers(catalog.chapters, "order", errors);
  validateUniqueNumbers(catalog.features, "number", errors);
  validateUniqueNumbers(catalog.features, "order", errors);

  const chapterIds = new Set(catalog.chapters.map((record) => record.id));
  const featureIds = new Set(catalog.features.map((record) => record.id));
  const capabilityIds = new Set(
    catalog.capabilities.map((record) => record.id),
  );

  for (const chapter of catalog.chapters) {
    requireNumber(chapter, "order", errors);
    requireString(chapter, "promise", errors);
    const features = requireStringArray(chapter, "features", errors);
    validateReferences(chapter, "features", features, featureIds, errors);
  }

  for (const feature of catalog.features) {
    requireNumber(feature, "number", errors);
    requireNumber(feature, "order", errors);
    requireString(feature, "summary", errors);
    requireString(feature, "example_workflow", errors);
    requireString(feature, "works_today", errors);
    requireString(feature, "remains", errors);
    requireEnum(feature, "roadmap_status", roadmapStatuses, errors);
    const chapter = requireString(feature, "chapter", errors);
    if (chapter && !chapterIds.has(chapter)) {
      errors.push(
        `${displayPath(feature.file)}: chapter references unknown id ${chapter}`,
      );
    }
    const required = requireStringArray(
      feature,
      "required_capabilities",
      errors,
    );
    const enhancing = requireStringArray(
      feature,
      "enhancing_capabilities",
      errors,
    );
    requireStringArray(feature, "increments", errors);
    validateReferences(
      feature,
      "required_capabilities",
      required,
      capabilityIds,
      errors,
    );
    validateReferences(
      feature,
      "enhancing_capabilities",
      enhancing,
      capabilityIds,
      errors,
    );
    for (const capabilityId of [...required, ...enhancing]) {
      if (recordsById.get(capabilityId)?.data.state === "superseded") {
        errors.push(
          `${displayPath(feature.file)}: Feature capability references must target active Capabilities, not superseded ${capabilityId}`,
        );
      }
    }
    if (required.some((id) => enhancing.includes(id))) {
      errors.push(
        `${displayPath(feature.file)}: a capability cannot be both required and enhancing`,
      );
    }
    if (feature.data.roadmap_status === "available") {
      const incomplete = required.filter(
        (id) => recordsById.get(id)?.data.state !== "verified",
      );
      if (incomplete.length > 0) {
        errors.push(
          `${displayPath(feature.file)}: available Feature has unverified required capabilities: ${incomplete.join(", ")}`,
        );
      }
      if (
        typeof feature.data.feature_proof !== "string" ||
        !feature.data.feature_proof.trim()
      ) {
        errors.push(
          `${displayPath(feature.file)}: available Feature requires a non-empty feature_proof receipt`,
        );
      }
    }
  }

  const dependencyGraph = new Map<string, string[]>();
  for (const capability of catalog.capabilities) {
    requireString(capability, "user_promise", errors);
    requireString(capability, "acceptance_summary", errors);
    requireEnum(capability, "kind", capabilityKinds, errors);
    requireEnum(capability, "state", capabilityStates, errors);
    requireEnum(capability, "availability", availabilityValues, errors);
    requireEnum(capability, "roadmap_boundary", roadmapBoundaries, errors);
    const dependencies = requireStringArray(capability, "dependencies", errors);
    const relatedFeatures = requireStringArray(
      capability,
      "related_features",
      errors,
    );
    const proofRequirements = requireStringArray(
      capability,
      "proof_requirements",
      errors,
    );
    requireStringArray(capability, "evidence", errors);
    validateReferences(
      capability,
      "dependencies",
      dependencies,
      capabilityIds,
      errors,
    );
    validateReferences(
      capability,
      "related_features",
      relatedFeatures,
      featureIds,
      errors,
    );
    dependencyGraph.set(capability.id, dependencies);
    if (dependencies.includes(capability.id)) {
      errors.push(
        `${displayPath(capability.file)}: dependencies cannot include itself`,
      );
    }
    if (capability.data.state !== "superseded") {
      for (const dependency of dependencies) {
        if (recordsById.get(dependency)?.data.state === "superseded") {
          errors.push(
            `${displayPath(capability.file)}: active Capability dependencies must target active Capabilities, not superseded ${dependency}`,
          );
        }
      }
    }
    if (
      relatedFeatures.length === 0 &&
      !["supporting", "deferred", "superseded"].includes(
        String(capability.data.roadmap_boundary),
      )
    ) {
      errors.push(
        `${displayPath(capability.file)}: orphaned capability must declare a supporting, deferred, or superseded roadmap_boundary`,
      );
    }
    if (capability.data.state === "verified") {
      const evidence = stringArrayField(capability, "evidence");
      if (evidence.length === 0) {
        errors.push(
          `${displayPath(capability.file)}: verified capability requires evidence`,
        );
      }
    }
    if (capability.data.state === "superseded") {
      const target = requireString(capability, "superseded_by", errors);
      if (target && !capabilityIds.has(target)) {
        errors.push(
          `${displayPath(capability.file)}: superseded_by references unknown id ${target}`,
        );
      }
      if (target === capability.id) {
        errors.push(
          `${displayPath(capability.file)}: superseded_by cannot reference itself`,
        );
      }
      if (target && recordsById.get(target)?.data.state === "superseded") {
        errors.push(
          `${displayPath(capability.file)}: superseded_by must reference an active terminal Capability, not superseded ${target}`,
        );
      }
    } else if (capability.data.superseded_by !== null) {
      errors.push(
        `${displayPath(capability.file)}: superseded_by must be null unless state is superseded`,
      );
    }
    if (capability.data.spec_version !== undefined) {
      const specVersion = requireNumber(capability, "spec_version", errors);
      if (specVersion !== 2) {
        errors.push(
          `${displayPath(capability.file)}: spec_version must be 2 when present`,
        );
      } else {
        validateCapabilityMiniSpec(capability, proofRequirements, errors);
      }
    }
  }

  validateDependencyCycles(dependencyGraph, recordsById, errors);

  for (const chapter of catalog.chapters) {
    for (const featureId of stringArrayField(chapter, "features")) {
      const feature = recordsById.get(featureId);
      if (feature && feature.data.chapter !== chapter.id) {
        errors.push(
          `${displayPath(chapter.file)}: Feature ${featureId} points back to ${String(feature.data.chapter)} instead of ${chapter.id}`,
        );
      }
    }
  }

  for (const feature of catalog.features) {
    const chapter = recordsById.get(stringField(feature, "chapter"));
    if (
      chapter &&
      !stringArrayField(chapter, "features").includes(feature.id)
    ) {
      errors.push(
        `${displayPath(chapter.file)}: features must include ${feature.id} because the Feature declares chapter ${chapter.id}`,
      );
    }
  }

  for (const feature of catalog.features) {
    for (const capabilityId of [
      ...stringArrayField(feature, "required_capabilities"),
      ...stringArrayField(feature, "enhancing_capabilities"),
    ]) {
      const capability = recordsById.get(capabilityId);
      if (
        capability &&
        !stringArrayField(capability, "related_features").includes(feature.id)
      ) {
        errors.push(
          `${displayPath(capability.file)}: related_features must include ${feature.id} because the Feature references this capability`,
        );
      }
    }
  }

  for (const capability of catalog.capabilities) {
    for (const featureId of stringArrayField(capability, "related_features")) {
      const feature = recordsById.get(featureId);
      if (
        feature &&
        ![
          ...stringArrayField(feature, "required_capabilities"),
          ...stringArrayField(feature, "enhancing_capabilities"),
        ].includes(capability.id)
      ) {
        errors.push(
          `${displayPath(feature.file)}: required_capabilities or enhancing_capabilities must include ${capability.id} because the Capability declares related Feature ${feature.id}`,
        );
      }
    }
  }

  if (strictCatalog) {
    const legacyCapabilities = catalog.capabilities.filter(
      (capability) => capability.data.spec_version !== 2,
    );
    if (legacyCapabilities.length > 0) {
      errors.push(
        `catalog: every Capability must use spec_version 2; legacy records: ${legacyCapabilities
          .map((capability) => capability.id)
          .join(", ")}`,
      );
    }
    if (catalog.chapters.length !== 6) {
      errors.push(
        `catalog: expected 6 Chapters, found ${catalog.chapters.length}`,
      );
    }
    if (catalog.features.length !== 32) {
      errors.push(
        `catalog: expected 32 Features, found ${catalog.features.length}`,
      );
    }
    if (catalog.capabilities.length !== 124) {
      errors.push(
        `catalog: expected 124 Capabilities, found ${catalog.capabilities.length}`,
      );
    }
    const incrementCount = catalog.features.reduce(
      (total, feature) =>
        total + stringArrayField(feature, "increments").length,
      0,
    );
    if (incrementCount !== 1) {
      errors.push(
        `catalog: expected 1 named increment, found ${incrementCount}`,
      );
    }
  }
}

function validateCapabilityMiniSpec(
  capability: ProductRecord,
  proofRequirements: string[],
  errors: string[],
) {
  const primaryUserJob = requireString(capability, "primary_user_job", errors);
  if (
    primaryUserJob &&
    primaryUserJob === stringField(capability, "user_promise")
  ) {
    errors.push(
      `${displayPath(capability.file)}: primary_user_job must explain the job in the user's terms rather than duplicate user_promise`,
    );
  }
  if (proofRequirements.length < 3) {
    errors.push(
      `${displayPath(capability.file)}: spec_version 2 requires at least 3 concrete proof_requirements`,
    );
  }

  const acceptanceSummary = stringField(capability, "acceptance_summary");
  if (/^A complete proof demonstrates:/i.test(acceptanceSummary)) {
    errors.push(
      `${displayPath(capability.file)}: acceptance_summary must describe the observable completion boundary, not repeat the legacy generated prefix`,
    );
  }

  const headings = [
    "## Why this exists",
    "## Example workflow",
    "## Product contract",
    "## Boundaries and non-goals",
    "## Acceptance stories",
    "## Current evidence",
    "## Proof plan",
    "## Open questions",
  ];
  let previousIndex = -1;
  for (const heading of headings) {
    const headingCount = capability.body
      .split("\n")
      .filter((line) => line === heading).length;
    const index = capability.body.indexOf(heading);
    if (index < 0) {
      errors.push(
        `${displayPath(capability.file)}: spec_version 2 requires ${heading}`,
      );
      continue;
    }
    if (headingCount !== 1) {
      errors.push(
        `${displayPath(capability.file)}: spec_version 2 requires exactly one ${heading}`,
      );
    }
    if (index < previousIndex) {
      errors.push(
        `${displayPath(capability.file)}: ${heading} must follow the preceding mini-spec section`,
      );
    }
    previousIndex = index;
  }

  const whyThisExists = extractSection(
    capability.body,
    "## Why this exists",
    "## Example workflow",
  ).trim();
  if (
    whyThisExists &&
    (whyThisExists === primaryUserJob ||
      whyThisExists === stringField(capability, "user_promise"))
  ) {
    errors.push(
      `${displayPath(capability.file)}: Why this exists must explain the human problem rather than repeat frontmatter`,
    );
  }

  const acceptanceStories = extractSection(
    capability.body,
    "## Acceptance stories",
    "## Current evidence",
  );
  const scenarioCount = [...acceptanceStories.matchAll(/^### .+$/gm)].length;
  if (scenarioCount < 2) {
    errors.push(
      `${displayPath(capability.file)}: spec_version 2 requires at least 2 independently named acceptance stories`,
    );
  }
  if (
    acceptanceStories &&
    !/\bGiven\b[\s\S]*\bwhen\b[\s\S]*\bthen\b/i.test(acceptanceStories)
  ) {
    errors.push(
      `${displayPath(capability.file)}: acceptance stories must include observable Given/when/then behavior`,
    );
  }

  const currentEvidence = extractSection(
    capability.body,
    "## Current evidence",
    "## Proof plan",
  );
  if (
    !currentEvidence ||
    /^Existing code may provide useful substrate/i.test(currentEvidence)
  ) {
    errors.push(
      `${displayPath(capability.file)}: Current evidence must name concrete implementation truth or explicitly say that none exists`,
    );
  }

  const genericPatterns: Array<[RegExp, string]> = [
    [
      /A person uses .+ in an authorized document workflow/i,
      "replace the generic example workflow with a concrete actor, object, action, and outcome",
    ],
    [
      /^### Complete the ordinary workflow$/m,
      "replace the generic acceptance-story heading with a capability-specific scenario",
    ],
    [
      /^### Preserve truth at the boundary$/m,
      "replace the generic failure story with the actual boundary this capability must preserve",
    ],
    [
      /^### Preserve the governing boundary$/m,
      "name the actual authority, permission, or data boundary in the acceptance story",
    ],
    [
      /^### Record an ordinary outcome$/m,
      "name the observable capability-specific outcome in the acceptance story",
    ],
    [
      /^1\. Exercise the typed contract, authorization, validation, Events, history, and recovery\.$/m,
      "replace the generic proof plan with capability-specific evidence",
    ],
    [
      /Implementation choices, exact controls, and rollout order remain open only where they preserve this contract/i,
      "replace the generic open-questions sentence with real capability-specific questions or an explicit statement that none remain",
    ],
  ];
  for (const [pattern, repair] of genericPatterns) {
    if (pattern.test(capability.body)) {
      errors.push(`${displayPath(capability.file)}: ${repair}`);
    }
  }
}

function validateLinksAndPrivacy(
  catalog: ProductCatalog,
  errors: string[],
  validationRoot: string,
) {
  const files = collectMarkdownFiles(catalog.root);
  const skillRoot = join(
    resolve(catalog.root, "../.."),
    ".agents/skills/content-product-development",
  );
  if (existsSync(skillRoot)) files.push(...collectMarkdownFiles(skillRoot));

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const privacyFindings: Array<[RegExp, string]> = [
      [
        /(?:^|[\s('"`:<>=])\/(?:Users|home|private|Volumes)\//m,
        "absolute filesystem path",
      ],
      [/\b[A-Za-z]:\\(?:Users|Documents|Desktop)\\/i, "absolute Windows path"],
      [/\bfile:\/\//i, "file URL"],
      [/\[\[[^\]]+\]\]/, "vault-style wikilink"],
      [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "email address"],
      [
        /\b(?:sk|ghp|gho|xoxb|xoxp|xoxa|xoxr)_[A-Za-z0-9_-]{12,}\b/,
        "credential-shaped value",
      ],
      [
        /https?:\/\/(?:www\.)?notion\.so\/[a-z0-9-]+\/[a-f0-9]{20,}/i,
        "private Notion-shaped URL",
      ],
      [
        /https?:\/\/[^\s)>]+\.slack\.com\/(?:archives|client)\//i,
        "private Slack-shaped URL",
      ],
      [
        /https?:\/\/clips\.agent-native\.com\/share\//i,
        "private Clips share URL",
      ],
    ];
    for (const [pattern, label] of privacyFindings) {
      const match = source.match(pattern);
      if (match) {
        errors.push(
          `${displayPath(file)}:${lineNumber(source, match.index ?? 0)}: remove ${label}`,
        );
      }
    }

    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim();
      if (
        !target ||
        target.startsWith("#") ||
        /^(?:https?:|mailto:)/i.test(target)
      ) {
        continue;
      }
      const withoutAnchor = target.split("#")[0];
      const resolved = resolve(dirname(file), withoutAnchor);
      if (!isInside(validationRoot, resolved)) {
        errors.push(
          `${displayPath(file)}:${lineNumber(source, match.index ?? 0)}: link escapes the repository: ${target}`,
        );
      } else if (!existsSync(resolved)) {
        errors.push(
          `${displayPath(file)}:${lineNumber(source, match.index ?? 0)}: broken relative link: ${target}`,
        );
      }
    }
  }
}

function validateForbiddenFrontmatter(record: ProductRecord, errors: string[]) {
  const forbidden = [
    "type",
    "context",
    "authored-by",
    "brief-kind",
    "decision-stage",
    "related-briefs",
    "related-drafts",
    "related-objectives",
  ];
  for (const key of forbidden) {
    if (key in record.data) {
      errors.push(
        `${displayPath(record.file)}: remove vault-only frontmatter field ${key}`,
      );
    }
  }
}

function validateUniqueNumbers(
  records: ProductRecord[],
  field: string,
  errors: string[],
) {
  const seen = new Map<number, ProductRecord>();
  for (const record of records) {
    const value = record.data[field];
    if (typeof value !== "number") continue;
    const previous = seen.get(value);
    if (previous) {
      errors.push(
        `${displayPath(record.file)}: ${field} ${value} collides with ${displayPath(previous.file)}`,
      );
    } else {
      seen.set(value, record);
    }
  }
}

function validateReferences(
  record: ProductRecord,
  field: string,
  values: string[],
  known: Set<string>,
  errors: string[],
) {
  for (const value of values) {
    if (!known.has(value)) {
      errors.push(
        `${displayPath(record.file)}: ${field} references unknown id ${value}`,
      );
    }
  }
}

function validateDependencyCycles(
  graph: Map<string, string[]>,
  recordsById: Map<string, ProductRecord>,
  errors: string[],
) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (id: string) => {
    if (active.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      errors.push(
        `${displayPath(recordsById.get(id)?.file ?? id)}: dependency cycle: ${cycle.join(" -> ")}`,
      );
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    path.push(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    path.pop();
    active.delete(id);
  };

  for (const id of graph.keys()) visit(id);
}

function compareProjection(file: string, expected: string, errors: string[]) {
  if (!existsSync(file)) {
    errors.push(
      `${displayPath(file)}: missing generated projection; run pnpm guard:content-product-docs --write`,
    );
    return;
  }
  const actual = readFileSync(file, "utf8");
  if (actual !== expected) {
    errors.push(
      `${displayPath(file)}: stale generated projection; run pnpm guard:content-product-docs --write`,
    );
  }
}

function collectMarkdownFiles(root: string) {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const file = join(directory, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name.endsWith(".md")) files.push(file);
    }
  };
  walk(root);
  return files;
}

function requireString(record: ProductRecord, field: string, errors: string[]) {
  const value = record.data[field];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(
      `${displayPath(record.file)}: ${field} must be a non-empty string`,
    );
    return "";
  }
  return value;
}

function requireNumber(record: ProductRecord, field: string, errors: string[]) {
  const value = record.data[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${displayPath(record.file)}: ${field} must be a number`);
    return 0;
  }
  return value;
}

function requireStringArray(
  record: ProductRecord,
  field: string,
  errors: string[],
) {
  const value = record.data[field];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    errors.push(
      `${displayPath(record.file)}: ${field} must be an array of strings`,
    );
    return [];
  }
  if (new Set(value).size !== value.length) {
    errors.push(
      `${displayPath(record.file)}: ${field} contains duplicate values`,
    );
  }
  return value as string[];
}

function requireEnum(
  record: ProductRecord,
  field: string,
  allowed: Set<string>,
  errors: string[],
) {
  const value = requireString(record, field, errors);
  if (value && !allowed.has(value)) {
    errors.push(
      `${displayPath(record.file)}: ${field} must be one of ${[...allowed].join(", ")}; found ${value}`,
    );
  }
}

function requireDate(record: ProductRecord, field: string, errors: string[]) {
  const value = requireString(record, field, errors);
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${displayPath(record.file)}: ${field} must use YYYY-MM-DD`);
  }
}

function stringField(record: ProductRecord, field: string) {
  return typeof record.data[field] === "string"
    ? (record.data[field] as string)
    : "";
}

function numberField(record: ProductRecord, field: string) {
  return typeof record.data[field] === "number"
    ? (record.data[field] as number)
    : 0;
}

function stringArrayField(record: ProductRecord, field: string) {
  const value = record.data[field];
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : [];
}

function extractSection(body: string, heading: string, endHeading: string) {
  const start = body.indexOf(heading);
  if (start < 0) return "";
  const contentStart = start + heading.length;
  const end = body.indexOf(endHeading, contentStart);
  return body.slice(contentStart, end < 0 ? body.length : end).trim();
}

function extractIncrement(body: string) {
  const match = body.match(/^## Increment: (.+)$/m);
  if (!match || match.index === undefined) return null;
  return {
    name: match[1].trim(),
    body: body.slice(match.index + match[0].length).trim(),
  };
}

function renderCapabilityLinks(
  ids: string[],
  capabilityById: Map<string, ProductRecord>,
) {
  return ids
    .map((id) => {
      const record = capabilityById.get(id);
      return `[${record ? stringField(record, "name") : id}](capabilities/${id}.md)`;
    })
    .join(", ");
}

function renderFamilyGraph(capabilities: ProductRecord[]) {
  const edges = new Set<string>();
  const labels = new Map<string, string>();
  for (const capability of capabilities) {
    const source = capability.id.split(".")[1] ?? "other";
    labels.set(source, titleCase(source));
    for (const dependency of stringArrayField(capability, "dependencies")) {
      const target = dependency.split(".")[1] ?? "other";
      labels.set(target, titleCase(target));
      if (source !== target) edges.add(`${target}-->${source}`);
    }
  }
  const lines = ["```mermaid", "graph LR"];
  for (const [id, label] of [...labels].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${mermaidId(id)}[\"${label}\"]`);
  }
  for (const edge of [...edges].sort()) {
    const [source, target] = edge.split("-->");
    lines.push(`  ${mermaidId(source)} --> ${mermaidId(target)}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function mermaidId(value: string) {
  return `family_${value.replace(/[^a-z0-9]/gi, "_")}`;
}

function displayRoadmapStatus(value: string) {
  const labels: Record<string, string> = {
    available: "Available",
    in_validation: "In validation",
    partially_implemented: "Partially implemented",
    paused: "Paused",
    planned: "Planned",
  };
  return labels[value] ?? titleCase(value.replace(/_/g, " "));
}

function displayCapabilityState(value: string) {
  return titleCase(value.replace(/_/g, " "));
}

function displayCapabilityFamily(value: string) {
  const labels: Record<string, string> = {
    api: "API",
  };
  return labels[value] ?? titleCase(value);
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function renderMarkdownTable(
  rows: string[][],
  alignments: Array<"left" | "right"> = [],
) {
  const widths = rows[0].map((_, column) =>
    Math.max(3, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const renderRow = (row: string[]) =>
    `| ${row
      .map((cell, column) =>
        alignments[column] === "right"
          ? cell.padStart(widths[column])
          : cell.padEnd(widths[column]),
      )
      .join(" | ")} |`;
  const separator = widths.map((width, column) =>
    alignments[column] === "right"
      ? `${"-".repeat(Math.max(2, width - 1))}:`
      : "-".repeat(width),
  );
  return [
    renderRow(rows[0]),
    renderRow(separator),
    ...rows.slice(1).map(renderRow),
  ];
}

function generatedNotice() {
  return "<!-- Generated from the atomic records in chapters/, features/, and capabilities/. Do not edit this projection directly. -->";
}

function displayPath(file: string) {
  return isInside(repositoryRoot, file) ? relative(repositoryRoot, file) : file;
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function lineNumber(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function formatErrors(errors: string[]) {
  return `[content-product-docs] ${errors.length} error(s):\n${errors.map((error) => `- ${error}`).join("\n")}`;
}

function parseArgs(args: string[]) {
  let root = defaultProductRoot;
  let write = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write") {
      write = true;
      continue;
    }
    if (argument === "--root") {
      const value = args[index + 1];
      if (!value) throw new Error("--root requires a path");
      root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { root, write };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.write) writeContentProductProjections(args.root);
  const result = validateContentProductDocs(args.root);
  if (result.errors.length > 0) {
    console.error(formatErrors(result.errors));
    process.exitCode = 1;
    return;
  }
  console.log(
    `[content-product-docs] Validated ${result.catalog.chapters.length} Chapters, ${result.catalog.features.length} Features, and ${result.catalog.capabilities.length} Capabilities`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
