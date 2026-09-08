import type { MigrationRun, MigrationTask, ProjectIR } from "./types.js";

export type MigrationRouteOwner =
  | "builder-page"
  | "builder-section"
  | "agent-native-route"
  | "headless"
  | "manual";

export type AemMigrationMode =
  | "crawl"
  | "api"
  | "package"
  | "code"
  | "enterprise";

export type AemContentFragmentPolicy =
  | "builder-data-model"
  | "headless"
  | "agent-native-sql"
  | "manual";

export type AemExperienceFragmentPolicy =
  | "builder-symbol"
  | "builder-section"
  | "react-component"
  | "manual";

export type AemComponentPolicy =
  | "react-component"
  | "builder-registered-component"
  | "manual";

export type JQueryMigrationPolicy =
  | "rewrite"
  | "temporary-wrapper"
  | "drop-authoring-only"
  | "manual";

export interface MigrationRouteOwnershipRule {
  pattern: string;
  owner: MigrationRouteOwner;
  notes?: string;
}

export interface MigrationPlanInputs {
  summary?: string;
  notes?: string;
  aem?: {
    modes?: AemMigrationMode[];
    evidence?: string[];
    contentFragmentPolicy?: AemContentFragmentPolicy;
    experienceFragmentPolicy?: AemExperienceFragmentPolicy;
    componentPolicy?: AemComponentPolicy;
  };
  builder?: {
    enabled?: boolean;
    routeOwnership?: MigrationRouteOwnershipRule[];
    componentRegistration?: "register" | "manual" | "skip";
    notes?: string;
  };
  headless?: {
    provider?: string;
    routePatterns?: string[];
    notes?: string;
  };
  jquery?: {
    policy?: JQueryMigrationPolicy;
    classifications?: Array<{
      pattern: string;
      policy: JQueryMigrationPolicy;
      notes?: string;
    }>;
  };
  verification?: {
    sampleSize?: number;
    required?: string[];
    notes?: string;
  };
}

export interface PlanMigrationOptions {
  planInputs?: MigrationPlanInputs | null;
}

const AEM_MODES = [
  "crawl",
  "api",
  "package",
  "code",
  "enterprise",
] as const satisfies readonly AemMigrationMode[];

const AEM_CONTENT_FRAGMENT_POLICIES = [
  "builder-data-model",
  "headless",
  "agent-native-sql",
  "manual",
] as const satisfies readonly AemContentFragmentPolicy[];

const AEM_EXPERIENCE_FRAGMENT_POLICIES = [
  "builder-symbol",
  "builder-section",
  "react-component",
  "manual",
] as const satisfies readonly AemExperienceFragmentPolicy[];

const AEM_COMPONENT_POLICIES = [
  "react-component",
  "builder-registered-component",
  "manual",
] as const satisfies readonly AemComponentPolicy[];

const ROUTE_OWNERS = [
  "builder-page",
  "builder-section",
  "agent-native-route",
  "headless",
  "manual",
] as const satisfies readonly MigrationRouteOwner[];

const BUILDER_COMPONENT_REGISTRATION_POLICIES = [
  "register",
  "manual",
  "skip",
] as const;

const JQUERY_POLICIES = [
  "rewrite",
  "temporary-wrapper",
  "drop-authoring-only",
  "manual",
] as const satisfies readonly JQueryMigrationPolicy[];

export function parseMigrationPlanInputsText(
  text: string,
  sourceLabel = "custom plan",
): MigrationPlanInputs | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return normalizeMigrationPlanInputs(JSON.parse(trimmed));
  } catch {
    return inferPlanInputsFromNotes(trimmed, sourceLabel);
  }
}

export function normalizeMigrationPlanInputs(
  value: unknown,
): MigrationPlanInputs | null {
  if (!isRecord(value)) return null;

  const summary = cleanString(value.summary);
  const notes = cleanString(value.notes);
  const aemValue = isRecord(value.aem) ? value.aem : {};
  const builderValue = isRecord(value.builder) ? value.builder : {};
  const headlessValue = isRecord(value.headless) ? value.headless : {};
  const jqueryValue = isRecord(value.jquery) ? value.jquery : {};
  const verificationValue = isRecord(value.verification)
    ? value.verification
    : {};

  const normalized: MigrationPlanInputs = {};
  if (summary) normalized.summary = summary;
  if (notes) normalized.notes = notes;

  const aem = {
    modes: arrayOfEnum(aemValue.modes, AEM_MODES),
    evidence: arrayOfStrings(aemValue.evidence),
    contentFragmentPolicy: enumValue(
      aemValue.contentFragmentPolicy,
      AEM_CONTENT_FRAGMENT_POLICIES,
    ),
    experienceFragmentPolicy: enumValue(
      aemValue.experienceFragmentPolicy,
      AEM_EXPERIENCE_FRAGMENT_POLICIES,
    ),
    componentPolicy: enumValue(
      aemValue.componentPolicy,
      AEM_COMPONENT_POLICIES,
    ),
  };
  if (
    aem.modes.length ||
    aem.evidence.length ||
    aem.contentFragmentPolicy ||
    aem.experienceFragmentPolicy ||
    aem.componentPolicy
  ) {
    normalized.aem = stripEmptyArrays(aem);
  }

  const routeOwnership = normalizeRouteOwnership(builderValue.routeOwnership);
  const builder = {
    enabled:
      typeof builderValue.enabled === "boolean"
        ? builderValue.enabled
        : undefined,
    routeOwnership,
    componentRegistration: enumValue(
      builderValue.componentRegistration,
      BUILDER_COMPONENT_REGISTRATION_POLICIES,
    ),
    notes: cleanString(builderValue.notes),
  };
  if (
    builder.enabled !== undefined ||
    builder.routeOwnership.length ||
    builder.componentRegistration ||
    builder.notes
  ) {
    normalized.builder = stripEmptyArrays(builder);
  }

  const headless = {
    provider: cleanString(headlessValue.provider),
    routePatterns: arrayOfStrings(headlessValue.routePatterns),
    notes: cleanString(headlessValue.notes),
  };
  if (headless.provider || headless.routePatterns.length || headless.notes) {
    normalized.headless = stripEmptyArrays(headless);
  }

  const jquery = {
    policy: enumValue(jqueryValue.policy, JQUERY_POLICIES),
    classifications: normalizeJQueryClassifications(
      jqueryValue.classifications,
    ),
  };
  if (jquery.policy || jquery.classifications?.length) {
    normalized.jquery = stripEmptyArrays(jquery);
  }

  const verification = {
    sampleSize:
      typeof verificationValue.sampleSize === "number" &&
      Number.isFinite(verificationValue.sampleSize) &&
      verificationValue.sampleSize > 0
        ? Math.floor(verificationValue.sampleSize)
        : undefined,
    required: arrayOfStrings(verificationValue.required),
    notes: cleanString(verificationValue.notes),
  };
  if (
    verification.sampleSize ||
    verification.required.length ||
    verification.notes
  ) {
    normalized.verification = stripEmptyArrays(verification);
  }

  return Object.keys(normalized).length ? normalized : null;
}

export function migrationPlanInputTasks(
  run: MigrationRun,
  ir: ProjectIR,
  planInputs: MigrationPlanInputs | null | undefined,
): MigrationTask[] {
  if (!planInputs) return [];

  const tasks: Array<Omit<MigrationTask, "id" | "runId" | "updatedAt">> = [];
  const now = new Date().toISOString();
  const aem = planInputs.aem;
  const builder = planInputs.builder;
  const headless = planInputs.headless;
  const jquery = planInputs.jquery;
  const verification = planInputs.verification;

  if (aem?.modes?.length) {
    tasks.push({
      recipeName: "aem-evidence-inventory",
      title: `Inventory AEM evidence from ${aem.modes.join(", ")} mode(s)`,
      status: "pending",
      confidence: aem.modes.includes("enterprise") ? "medium" : "high",
      targetIds: [],
      summary:
        "Collect the requested AEM evidence before output work: crawl/sitemap, GraphQL Content Fragments, Vault/JCR package data, HTL dialogs, templates, policies, Sling models, DAM assets, and explicit gap notes.",
    });
  }

  if (aem?.contentFragmentPolicy) {
    tasks.push({
      recipeName: "aem-content-fragments-to-target-models",
      title: `Map AEM Content Fragment models to ${aem.contentFragmentPolicy}`,
      status: "pending",
      confidence: "medium",
      targetIds: [],
      summary:
        "Map Content Fragment models, fields, variations, locales, references, and associated assets into the approved target model. Record manual gaps for fields that need business decisions.",
    });
  }

  if (aem?.experienceFragmentPolicy) {
    tasks.push({
      recipeName: "aem-experience-fragments-to-components",
      title: `Map AEM Experience Fragments to ${aem.experienceFragmentPolicy}`,
      status: "pending",
      confidence: "medium",
      targetIds: [],
      summary:
        "Treat Experience Fragments as laid-out reusable sections. Preserve variation/localization behavior, referenced Content Fragments, component trees, and fallback rules.",
    });
  }

  if (aem?.componentPolicy) {
    tasks.push({
      recipeName: "aem-components-to-react",
      title: `Convert AEM components using ${aem.componentPolicy}`,
      status: "pending",
      confidence: "medium",
      targetIds: ir.components.components.map((component) => component.id),
      summary:
        "Convert HTL/Core/custom components, dialogs, design dialogs, policies, Sling model hints, clientlibs, and style-system classes into React components and Builder registration metadata when requested.",
    });
  }

  if (builder?.enabled || builder?.componentRegistration) {
    tasks.push({
      recipeName: "builder-component-registration-plan",
      title: "Prepare Builder component registration plan",
      status: "pending",
      confidence: "medium",
      targetIds: ir.components.components.map((component) => component.id),
      summary:
        "Generate the Builder registration contract for approved React components, including input names, types, defaults, allowed values, and which AEM dialog fields are intentionally omitted.",
    });
  }

  for (const rule of builder?.routeOwnership ?? []) {
    tasks.push({
      recipeName: "route-ownership-map",
      title: `Map routes matching ${rule.pattern} to ${rule.owner}`,
      status: "pending",
      confidence: "medium",
      targetIds: matchingRouteIds(ir, rule.pattern),
      summary:
        rule.notes ??
        "Preserve explicit route ownership so Builder pages, Builder sections, Agent-Native routes, headless routes, and manual exceptions do not blur together during the sweep.",
    });
  }

  if (headless?.provider || headless?.routePatterns?.length) {
    tasks.push({
      recipeName: "headless-dynamic-route-map",
      title: `Map dynamic routes to ${headless.provider ?? "the approved headless source"}`,
      status: "pending",
      confidence: "medium",
      targetIds:
        headless.routePatterns?.flatMap((pattern) =>
          matchingRouteIds(ir, pattern),
        ) ?? [],
      summary:
        headless.notes ??
        "Keep dynamic routes and provider-backed data out of Builder content blobs unless the approved plan explicitly says otherwise.",
    });
  }

  if (jquery?.policy || jquery?.classifications?.length) {
    tasks.push({
      recipeName: "jquery-clientlibs-to-react",
      title: `Classify jQuery/clientlib behavior${jquery.policy ? ` with ${jquery.policy} policy` : ""}`,
      status: "pending",
      confidence: "low",
      targetIds: [],
      summary:
        "Inventory selectors, event handlers, AJAX calls, plugins, validation, analytics, and authoring-only clientlibs. Rewrite common behavior into React; wrap unavoidable third-party widgets with refs/effects and cleanup; drop authoring-only scripts.",
    });
  }

  for (const item of jquery?.classifications ?? []) {
    tasks.push({
      recipeName: "jquery-clientlib-classification",
      title: `Handle ${item.pattern} jQuery/clientlib code as ${item.policy}`,
      status: "pending",
      confidence: item.policy === "manual" ? "low" : "medium",
      targetIds: [],
      summary: item.notes ?? "Apply the explicit jQuery migration policy.",
    });
  }

  if (verification?.required?.length || verification?.sampleSize) {
    tasks.push({
      recipeName: "sample-sweep-verification",
      title: `Verify sample/sweep gates${verification.sampleSize ? ` on ${verification.sampleSize} sample(s)` : ""}`,
      status: "pending",
      confidence: "medium",
      targetIds: [],
      summary:
        verification.notes ??
        `Run the approved parity gates: ${(verification.required ?? ["screenshots", "DOM/text", "metadata", "links", "assets", "console"]).join(", ")}.`,
    });
  }

  return tasks.map((task, index) => ({
    ...task,
    id: `${run.id}:plan-input-${index + 1}`,
    runId: run.id,
    updatedAt: now,
  }));
}

export function summarizeMigrationPlanInputs(
  planInputs: MigrationPlanInputs | null | undefined,
): string[] {
  if (!planInputs) return [];
  const lines: string[] = [];
  if (planInputs.summary) lines.push(`Summary: ${planInputs.summary}`);
  if (planInputs.aem?.modes?.length) {
    lines.push(`AEM modes: ${planInputs.aem.modes.join(", ")}`);
  }
  if (planInputs.aem?.contentFragmentPolicy) {
    lines.push(`Content Fragments: ${planInputs.aem.contentFragmentPolicy}`);
  }
  if (planInputs.aem?.experienceFragmentPolicy) {
    lines.push(
      `Experience Fragments: ${planInputs.aem.experienceFragmentPolicy}`,
    );
  }
  if (planInputs.aem?.componentPolicy) {
    lines.push(`AEM components: ${planInputs.aem.componentPolicy}`);
  }
  if (planInputs.builder?.enabled) lines.push("Builder target: enabled");
  if (planInputs.builder?.routeOwnership?.length) {
    lines.push(
      `Route ownership rules: ${planInputs.builder.routeOwnership.length}`,
    );
  }
  if (planInputs.headless?.provider) {
    lines.push(`Headless provider: ${planInputs.headless.provider}`);
  }
  if (planInputs.jquery?.policy) {
    lines.push(`jQuery policy: ${planInputs.jquery.policy}`);
  }
  if (planInputs.verification?.sampleSize) {
    lines.push(`Sample size: ${planInputs.verification.sampleSize}`);
  }
  return lines;
}

function inferPlanInputsFromNotes(
  notes: string,
  sourceLabel: string,
): MigrationPlanInputs {
  const lower = notes.toLowerCase();
  const mentionsAem =
    /\baem\b|adobe experience manager|content fragment|experience fragment|sling|htl|jcr|vault|dam/.test(
      lower,
    );
  const mentionsBuilder = /\bbuilder\b|fusion|publish|visual editor/.test(
    lower,
  );
  const mentionsJQuery = /\bjquery\b|\$\(|clientlib/.test(lower);
  const mentionsHeadless = /akeneo|akineo|headless|dynamic pages?/.test(lower);
  const planInputs: MigrationPlanInputs = {
    summary: firstLine(notes) ?? sourceLabel,
    notes,
  };

  if (mentionsAem) {
    const modes = new Set<AemMigrationMode>();
    if (/sitemap|crawl|url|page|screenshot|seo|redirect/.test(lower)) {
      modes.add("crawl");
    }
    if (/graphql|openapi|\bapi\b|content fragment/.test(lower)) {
      modes.add("api");
    }
    if (/package|vault|jcr|dam/.test(lower)) {
      modes.add("package");
    }
    if (
      /htl|sling|dialog|component|template|policy|clientlib|jquery/.test(lower)
    ) {
      modes.add("code");
    }
    if (
      modes.size === 0 ||
      /enterprise|hybrid|all available|migration off aem/.test(lower)
    ) {
      modes.add("enterprise");
    }
    planInputs.aem = {
      modes: [...modes],
      contentFragmentPolicy:
        lower.includes("akeneo") || lower.includes("akineo")
          ? "headless"
          : mentionsBuilder
            ? "builder-data-model"
            : "manual",
      experienceFragmentPolicy: mentionsBuilder
        ? "builder-section"
        : "react-component",
      componentPolicy: mentionsBuilder
        ? "builder-registered-component"
        : "react-component",
    };
  }

  if (mentionsBuilder) {
    planInputs.builder = {
      enabled: true,
      componentRegistration: "register",
      routeOwnership: [
        {
          pattern: "static/low-change pages",
          owner: "builder-page",
          notes:
            "Use Builder for static or low-change public pages that benefit from visual management.",
        },
      ],
    };
  }

  if (mentionsHeadless) {
    planInputs.headless = {
      provider:
        lower.includes("akeneo") || lower.includes("akineo")
          ? "Akeneo"
          : "headless",
      routePatterns: ["dynamic pages"],
      notes:
        "Keep dynamic provider-backed pages in code/headless data, with Builder used only for approved editorial slots.",
    };
    planInputs.builder = {
      ...(planInputs.builder ?? {}),
      routeOwnership: [
        ...(planInputs.builder?.routeOwnership ?? []),
        {
          pattern: "dynamic pages",
          owner: "headless",
          notes:
            "Route dynamic pages through the approved headless source instead of treating Builder as a content dump.",
        },
      ],
    };
  }

  if (mentionsJQuery) {
    planInputs.jquery = { policy: "rewrite" };
  }

  const sampleSize = inferSampleSize(lower);
  planInputs.verification = {
    sampleSize,
    required: [
      "screenshots",
      "DOM/text parity",
      "metadata",
      "links",
      "assets",
      "console",
    ],
  };

  return planInputs;
}

function normalizeRouteOwnership(
  value: unknown,
): MigrationRouteOwnershipRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const pattern = cleanString(item.pattern);
    const owner = enumValue(item.owner, ROUTE_OWNERS);
    if (!pattern || !owner) return [];
    return [{ pattern, owner, notes: cleanString(item.notes) }];
  });
}

function normalizeJQueryClassifications(
  value: unknown,
): NonNullable<MigrationPlanInputs["jquery"]>["classifications"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const pattern = cleanString(item.pattern);
    const policy = enumValue(item.policy, JQUERY_POLICIES);
    if (!pattern || !policy) return [];
    return [{ pattern, policy, notes: cleanString(item.notes) }];
  });
}

function matchingRouteIds(ir: ProjectIR, pattern: string): string[] {
  const lowerPattern = pattern.toLowerCase();
  if (
    lowerPattern.includes("static") ||
    lowerPattern.includes("marketing") ||
    lowerPattern.includes("low-change")
  ) {
    return ir.site.routes
      .filter((route) => route.kind === "marketing" || route.kind === "landing")
      .map((route) => route.id);
  }
  if (lowerPattern.includes("dynamic")) {
    return ir.site.routes
      .filter((route) => route.dynamic || route.kind === "app")
      .map((route) => route.id);
  }
  const regex = globishToRegex(pattern);
  return ir.site.routes
    .filter((route) => regex.test(route.path))
    .map((route) => route.id);
}

function globishToRegex(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.?+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = cleanString(item);
        return text ? [text] : [];
      })
    : [];
}

function arrayOfEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const found = enumValue(item, allowed);
    return found ? [found] : [];
  });
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== "string") return undefined;
  return allowed.find((item) => item === value);
}

function stripEmptyArrays<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      Array.isArray(item) ? item.length > 0 : item !== undefined,
    ),
  ) as T;
}

function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
    ?.slice(0, 140);
}

function inferSampleSize(text: string): number | undefined {
  const match = text.match(/(?:sample|representative)\D{0,20}(\d+)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
