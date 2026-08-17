import {
  frameworkGroupEnabled,
  type FrameworkToolGroup,
} from "../../framework-tools.js";
import {
  getFrontmatterValue,
  getSkillNameFromPath,
  parseFrontmatter,
} from "../../resources/metadata.js";
import {
  ensurePersonalDefaults,
  organizationIdFromResourceOwner,
  resourceGet,
  resourceGetByPath,
  resourceList,
  resourceListAccessible,
  SHARED_OWNER,
  sharedResourceOwner,
  WORKSPACE_OWNER,
} from "../../resources/store.js";
import type {
  ContextGovernanceTier,
  ContextManifestSourceRef,
  ContextSystemProvenance,
} from "../../shared/context-xray.js";
import { discoverAgents } from "../agent-discovery.js";
import { getRequestOrgId } from "../request-context.js";
import {
  isRuntimeVisibleScope,
  parseSkillFrontmatter,
} from "./skill-frontmatter.js";

// ---------------------------------------------------------------------------
// System-prompt resource loading: AGENTS.md, instructions/*.md, skills
// summaries, and the shared/workspace resource index. Assembled by
// `loadResourcesForPrompt`, the top-level orchestrator called once per
// request to build the "here's what you should know" context block.
// ---------------------------------------------------------------------------

const SHARED_PROMPT_RESOURCE_MAX_CHARS = 30_000;
export const COMPACT_PROMPT_RESOURCE_MAX_CHARS = 6_000;
const COMPACT_PROMPT_RESOURCES_TOTAL_MAX_CHARS = 48_000;
const PROMPT_CONTEXT_PROVIDER_MAX_CHARS = 8_000;

export interface PromptContextProviderContext {
  owner: string;
  compact: boolean;
  selfAppId?: string;
  orgId: string | null;
}

export interface PromptContextProviderContribution {
  content: string;
  label?: string;
  provenance?: ContextSystemProvenance;
  governance?: ContextGovernanceTier;
  sourceRef?: ContextManifestSourceRef;
}

export interface PromptContextProvider {
  id: string;
  load(
    context: PromptContextProviderContext,
  ):
    | Promise<PromptContextProviderContribution | null | undefined>
    | PromptContextProviderContribution
    | null
    | undefined;
}

const promptContextProviders = new Map<string, PromptContextProvider>();

/** Register a package-owned, request-scoped system-context contribution. */
export function registerPromptContextProvider(
  provider: PromptContextProvider,
): () => void {
  const id = provider.id.trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
    throw new Error(
      "Prompt context provider ids must be 2-64 lowercase letters, digits, or hyphens",
    );
  }
  const registered = { ...provider, id };
  promptContextProviders.set(id, registered);
  return () => {
    if (promptContextProviders.get(id) === registered) {
      promptContextProviders.delete(id);
    }
  };
}

function xmlAttributeEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadPromptContextProviderBlocks(
  context: PromptContextProviderContext,
): Promise<string[]> {
  const providers = [...promptContextProviders.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      provider,
      contribution: await provider.load(context),
    })),
  );
  const blocks: string[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { provider, contribution } = result.value;
    if (!contribution) continue;
    const content = contribution.content.trim();
    if (!content) continue;
    const boundedContent =
      content.length <= PROMPT_CONTEXT_PROVIDER_MAX_CHARS
        ? content
        : `${content.slice(0, PROMPT_CONTEXT_PROVIDER_MAX_CHARS)}\n[truncated after ${PROMPT_CONTEXT_PROVIDER_MAX_CHARS.toLocaleString()} characters]`;
    const label = contribution.label?.trim() || provider.id;
    const provenance = contribution.provenance ?? "runtime-context";
    const governance = contribution.governance ?? "inherited";
    const sourceScope = contribution.sourceRef?.scope?.trim() || "provider";
    const sourcePath = contribution.sourceRef?.path?.trim() || provider.id;
    blocks.push(
      `<prompt-context-provider id="${xmlAttributeEscape(provider.id)}" label="${xmlAttributeEscape(label)}" provenance="${provenance}" governance="${governance}" scope="${xmlAttributeEscape(sourceScope)}" path="${xmlAttributeEscape(sourcePath)}">\n${boundedContent.replace(/<\/prompt-context-provider>/gi, "&lt;/prompt-context-provider&gt;")}\n</prompt-context-provider>`,
    );
  }
  return blocks;
}

export function compactPromptLine(value: string, maxChars: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1)}…`;
}
const SHARED_RESOURCE_INDEX_LIMIT = 40;
const PROMPT_SKILL_SUMMARY_LIMIT = 40;
const PROMPT_SKILL_METADATA_READ_LIMIT = 80;
const PROMPT_INSTRUCTION_SUMMARY_LIMIT = 20;
const PROMPT_SUMMARY_DESCRIPTION_MAX_CHARS = 180;

export interface PromptResourceManifestSection {
  label: string;
  provenance: ContextSystemProvenance;
  governance: ContextGovernanceTier;
  content: string;
  sourceRef?: ContextManifestSourceRef;
}

function normalizeResourcePathForPrompt(path: string): string {
  return path.replace(/^\/+/, "").trim();
}

function xmlAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match?.[1];
}

function resourceManifestClassification(
  scope: string,
  path: string,
  index: number,
): {
  provenance: ContextSystemProvenance;
  governance: ContextGovernanceTier;
} {
  const normalizedPath = normalizeResourcePathForPrompt(path);
  if (scope === "template") {
    return { provenance: "template", governance: "inherited" };
  }
  if (scope.startsWith("workspace")) {
    return {
      provenance:
        scope === "workspace" && index === 0
          ? "enterprise-workspace-core"
          : "sql-workspace",
      governance:
        scope === "workspace" && index === 0 ? "required" : "inherited",
    };
  }
  if (scope.startsWith("personal")) {
    return {
      provenance: normalizedPath === "memory/MEMORY.md" ? "memory" : "personal",
      governance: "user",
    };
  }
  if (scope.startsWith("app-default")) {
    return { provenance: "legacy-app-default", governance: "inherited" };
  }
  if (scope.startsWith("organization")) {
    return { provenance: "organization", governance: "inherited" };
  }
  if (scope.startsWith("shared")) {
    return {
      provenance:
        normalizedPath === "LEARNINGS.md"
          ? "organization"
          : "legacy-app-default",
      governance: "inherited",
    };
  }
  return { provenance: "template", governance: "inherited" };
}

/**
 * Extracts bounded-in-memory metadata from the already-composed resource
 * prompt. The caller turns these inputs into hashed/previews before anything
 * is persisted; this helper never writes or returns the full manifest.
 */
export function promptResourceManifestSections(
  prompt: string,
): PromptResourceManifestSection[] {
  const sections: PromptResourceManifestSection[] = [];
  const resourcePattern = /<resource\b([^>]*)>([\s\S]*?)<\/resource>/g;
  let match: RegExpExecArray | null;
  let workspaceIndex = 0;
  let sharedIndex = 0;
  while ((match = resourcePattern.exec(prompt))) {
    const attrs = match[1] ?? "";
    const scope = xmlAttribute(attrs, "scope") ?? "resource";
    const path =
      xmlAttribute(attrs, "path") ?? xmlAttribute(attrs, "name") ?? "";
    const name = xmlAttribute(attrs, "name") ?? (path || "resource");
    const index = scope.startsWith("workspace")
      ? workspaceIndex++
      : scope.startsWith("shared")
        ? sharedIndex++
        : 0;
    const classification = resourceManifestClassification(scope, path, index);
    sections.push({
      label: name,
      ...classification,
      content: match[2] ?? "",
      sourceRef: {
        ...(path ? { path } : {}),
        scope,
      },
    });
  }

  const providerPattern =
    /<prompt-context-provider\b([^>]*)>([\s\S]*?)<\/prompt-context-provider>/g;
  while ((match = providerPattern.exec(prompt))) {
    const attrs = match[1] ?? "";
    const id = xmlAttribute(attrs, "id") ?? "prompt-context-provider";
    const label = xmlAttribute(attrs, "label") ?? id;
    const provenanceValue = xmlAttribute(attrs, "provenance");
    const governanceValue = xmlAttribute(attrs, "governance");
    const provenance = (
      [
        "framework-core",
        "actions-prompt",
        "template",
        "enterprise-workspace-core",
        "sql-workspace",
        "legacy-app-default",
        "organization",
        "personal",
        "memory",
        "db-schema",
        "tools",
        "model-overlay",
        "runtime-context",
      ] as const
    ).includes(provenanceValue as ContextSystemProvenance)
      ? (provenanceValue as ContextSystemProvenance)
      : "runtime-context";
    const governance = (["required", "inherited", "user"] as const).includes(
      governanceValue as ContextGovernanceTier,
    )
      ? (governanceValue as ContextGovernanceTier)
      : "inherited";
    sections.push({
      label,
      provenance,
      governance,
      content: match[2] ?? "",
      sourceRef: {
        path: xmlAttribute(attrs, "path") ?? id,
        scope: xmlAttribute(attrs, "scope") ?? "provider",
      },
    });
  }

  const taggedSections = [
    {
      tag: "skills-summary",
      label: "Workspace skills index",
      provenance: "template" as const,
      governance: "inherited" as const,
    },
    {
      tag: "resource-skills",
      label: "Workspace resource skills",
      provenance: "template" as const,
      governance: "inherited" as const,
    },
    {
      tag: "instruction-resources",
      label: "Instruction resources index",
      provenance: "sql-workspace" as const,
      governance: "inherited" as const,
    },
    {
      tag: "workspace-resources",
      label: "Workspace reference resources",
      provenance: "sql-workspace" as const,
      governance: "inherited" as const,
    },
    {
      tag: "context-note",
      label: "Resource availability note",
      provenance: "framework-core" as const,
      governance: "required" as const,
    },
    {
      tag: "context-budget-note",
      label: "Context budget note",
      provenance: "framework-core" as const,
      governance: "required" as const,
    },
    {
      tag: "available-apps",
      label: "Available workspace apps",
      provenance: "tools" as const,
      governance: "required" as const,
    },
  ];
  for (const tagged of taggedSections) {
    const pattern = new RegExp(
      `<${tagged.tag}\\b[^>]*>([\\s\\S]*?)</${tagged.tag}>`,
      "g",
    );
    let taggedMatch: RegExpExecArray | null;
    while ((taggedMatch = pattern.exec(prompt))) {
      const taggedAttrs =
        taggedMatch[0]?.slice(tagged.tag.length + 1).split(">")[0] ?? "";
      const taggedScope = xmlAttribute(taggedAttrs, "scope");
      const taggedClassification =
        tagged.tag === "instruction-resources" && taggedScope
          ? resourceManifestClassification(taggedScope, "", 0)
          : {
              provenance: tagged.provenance,
              governance: tagged.governance,
            };
      sections.push({
        label: tagged.label,
        ...taggedClassification,
        content: taggedMatch[1] ?? "",
        ...(taggedScope ? { sourceRef: { scope: taggedScope } } : {}),
      });
    }
  }
  return sections;
}

function resourceToolHint(
  action: "list" | "read" | "effective" | "write" | "delete" | "promote",
  extra?: string,
): string {
  return `Use the \`resources\` tool with \`action: "${action}"\`${extra ? `, ${extra}` : ""}.`;
}

function skillDocsSlug(name: string): string {
  return `skill-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function truncatePromptResourceContent(
  content: string,
  path: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
  readHint?: string,
): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const omitted = trimmed.length - maxChars;
  const hint =
    readHint ??
    resourceToolHint(
      "read",
      `\`path: "${path}"\` and the resource's \`scope\` for the full content`,
    );
  return `${trimmed.slice(0, maxChars)}\n\n[Resource ${path} truncated after ${maxChars.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted. ${hint}]`;
}

function promptResourceBlock(input: {
  name: string;
  scope: string;
  content: string;
  path?: string;
  maxChars?: number;
  readHint?: string;
}): string | null {
  const normalizedPath = input.path
    ? normalizeResourcePathForPrompt(input.path)
    : undefined;
  const content = truncatePromptResourceContent(
    input.content,
    normalizedPath ?? input.name,
    input.maxChars,
    input.readHint,
  );
  if (!content) return null;
  const pathAttr = normalizedPath
    ? ` path="${escapeXmlAttribute(normalizedPath)}"`
    : "";
  return `<resource name="${escapeXmlAttribute(input.name)}" scope="${escapeXmlAttribute(input.scope)}"${pathAttr}>\n${content}\n</resource>`;
}

/**
 * One assembled startup-context block plus the governance tier the context
 * manifest reports for it (`ContextGovernanceTier`). `required` is the tier
 * that already meant "not opt-out-able" in the manifest; the budget fitter
 * honours it as "reserve before anything else competes".
 */
export interface PromptSection {
  content: string;
  governance: ContextGovernanceTier;
}

export interface SkippedPromptSection {
  label: string;
  chars: number;
}

export interface PromptSectionBudgetResult {
  sections: string[];
  skipped: SkippedPromptSection[];
  /** Chars by which required sections alone exceeded `maxChars`, else 0. */
  overflowChars: number;
}

const PROMPT_SECTION_SEPARATOR = "\n\n";
const TRIM_NOTE_LABELS_MAX_CHARS = 300;
const TRIM_NOTE_MAX_CHARS = 700;

function promptSectionLabel(content: string): string {
  const open = /^<([a-z][a-z0-9-]*)\b([^>]*)>/i.exec(content.trimStart());
  if (!open) return "unlabelled context section";
  const attrs = open[2] ?? "";
  const name = xmlAttribute(attrs, "name") ?? xmlAttribute(attrs, "id");
  const scope = xmlAttribute(attrs, "scope");
  if (name) return scope ? `${name} (${scope})` : name;
  return scope ? `${open[1]} (${scope})` : (open[1] ?? "context section");
}

function promptBudgetTrimNote(
  skipped: SkippedPromptSection[],
  maxChars: number,
): string {
  const labels = compactPromptLine(
    skipped.map((section) => section.label).join(", "),
    TRIM_NOTE_LABELS_MAX_CHARS,
  );
  return `<context-budget-note>Your startup context was trimmed: ${skipped.length} section(s) did not fit the ${maxChars.toLocaleString()}-character first-request budget and were omitted (${labels}). Treat them as unread, not as absent — use \`resources\` with \`action: "list"\` or \`"read"\`, \`docs-search\`, and \`tool-search\` before telling the user something does not exist.</context-budget-note>`;
}

/**
 * Fits assembled startup context into `maxChars`, reserving `required`
 * sections before discretionary ones compete for the remainder, and reporting
 * every omission so an over-budget request is never silent.
 *
 * Required sections are never truncated and never dropped: a half-rendered
 * list of workspace apps or governance rules reads to the model as a complete
 * one, which is worse than an explicit note that a section is missing. If they
 * alone exceed the budget, the budget is exceeded deliberately, every
 * discretionary section is dropped, and `overflowChars` reports by how much.
 */
export function selectPromptSectionsWithinBudget(
  sections: PromptSection[],
  maxChars: number,
): PromptSectionBudgetResult {
  const required = sections.filter(
    (section) => section.governance === "required",
  );
  const keep = new Set<number>();
  const skipped: SkippedPromptSection[] = [];
  let used = required.reduce(
    (total, section) => total + section.content.length,
    0,
  );
  let count = required.length;
  const requiredFit =
    used + count * PROMPT_SECTION_SEPARATOR.length + TRIM_NOTE_MAX_CHARS <=
    maxChars;

  for (const [index, section] of sections.entries()) {
    if (section.governance === "required") {
      keep.add(index);
      continue;
    }
    const projected =
      used +
      section.content.length +
      (count + 1) * PROMPT_SECTION_SEPARATOR.length +
      TRIM_NOTE_MAX_CHARS;
    if (requiredFit && projected <= maxChars) {
      keep.add(index);
      used += section.content.length;
      count++;
    } else {
      skipped.push({
        label: promptSectionLabel(section.content),
        chars: section.content.length,
      });
    }
  }

  const selected = sections
    .filter((_section, index) => keep.has(index))
    .map((section) => section.content);
  if (skipped.length > 0) {
    selected.push(promptBudgetTrimNote(skipped, maxChars));
  }

  const totalChars =
    selected.reduce((total, section) => total + section.length, 0) +
    Math.max(0, selected.length - 1) * PROMPT_SECTION_SEPARATOR.length;
  return {
    sections: selected,
    skipped,
    overflowChars: requiredFit ? 0 : Math.max(0, totalChars - maxChars),
  };
}

function isAutoLoadedInstructionPath(path: string): boolean {
  const normalized = normalizeResourcePathForPrompt(path);
  return normalized.startsWith("instructions/") && normalized.endsWith(".md");
}

function isSpecialPromptResourcePath(path: string): boolean {
  const normalized = normalizeResourcePathForPrompt(path);
  return (
    normalized === "AGENTS.md" ||
    normalized === "LEARNINGS.md" ||
    normalized.startsWith("instructions/") ||
    normalized.startsWith("skills/") ||
    normalized.startsWith("agents/") ||
    normalized.startsWith("remote-agents/") ||
    normalized.startsWith("jobs/") ||
    normalized.startsWith("memory/")
  );
}

function isTextLikeResource(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/yaml" ||
    mimeType === "application/x-yaml"
  );
}

function getResourceSummaryFromContent(content: string): string | null {
  const frontmatter = parseFrontmatter(content);
  const title =
    getFrontmatterValue(frontmatter, "title") ||
    getFrontmatterValue(frontmatter, "name");
  const description = getFrontmatterValue(frontmatter, "description");
  if (title && description) return `${title}: ${description}`;
  if (title) return title;
  if (description) return description;

  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,3}\s+/, "").trim();
  return null;
}

export function resourceScopeForOwner(
  owner: string,
  currentOwner?: string,
): string {
  if (owner === WORKSPACE_OWNER) return "workspace";
  if (owner === SHARED_OWNER || organizationIdFromResourceOwner(owner)) {
    return "shared";
  }
  if (currentOwner && owner === currentOwner) return "personal";
  return "resource";
}

async function loadAgentsResourceForPrompt(
  owner: string,
  scope: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
): Promise<string | null> {
  let agents: Awaited<ReturnType<typeof resourceGetByPath>>;
  try {
    agents = await resourceGetByPath(owner, "AGENTS.md");
  } catch (error) {
    throw new Error(
      `Unable to read durable AGENTS.md instructions for ${scope} (${owner}). The run cannot safely continue without them.`,
      { cause: error },
    );
  }
  if (!agents?.content?.trim()) return null;
  return promptResourceBlock({
    name: "AGENTS.md",
    scope,
    path: "AGENTS.md",
    content: agents.content,
    maxChars,
  });
}

async function loadInstructionResourcesForPrompt(
  owner: string,
  scope: string,
  maxChars = SHARED_PROMPT_RESOURCE_MAX_CHARS,
  summaryOnly = false,
): Promise<string[]> {
  try {
    const resources = await resourceList(owner, "instructions/");
    const sorted = resources
      .filter((resource) => isAutoLoadedInstructionPath(resource.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (summaryOnly) {
      if (sorted.length === 0) return [];
      const resourceScope = scope.startsWith("workspace")
        ? "workspace"
        : scope.startsWith("personal")
          ? "personal"
          : "shared";
      const listed = sorted.slice(0, PROMPT_INSTRUCTION_SUMMARY_LIMIT);
      const lines = listed.map(
        (resource) =>
          `- \`${resource.path}\` - ${resourceToolHint("read", `\`path: "${resource.path}"\` and \`scope: "${resourceScope}"\` when it applies`)}`,
      );
      if (sorted.length > listed.length) {
        lines.push(
          `- ...${sorted.length - listed.length} more instruction files. ${resourceToolHint("list", `\`scope: "${resourceScope}"\` and \`prefix: "instructions/"\``)}`,
        );
      }
      return [
        `<instruction-resources scope="${escapeXmlAttribute(scope)}">\nDetailed instruction files are loaded on demand so the first model request stays compact. Read a relevant file before following its workflow.\n\n${lines.join("\n")}\n</instruction-resources>`,
      ];
    }

    const fullResources = await Promise.all(
      sorted.map((resource) => resourceGet(resource.id).catch(() => null)),
    );
    const blocks: string[] = [];
    for (let index = 0; index < sorted.length; index++) {
      const resource = sorted[index]!;
      const full = fullResources[index];
      if (!full?.content?.trim()) continue;
      const block = promptResourceBlock({
        name: resource.path,
        scope,
        path: resource.path,
        content: full.content,
        maxChars,
      });
      if (block) blocks.push(block);
    }
    return blocks;
  } catch {
    return [];
  }
}

async function loadResourceSkillsPromptBlock(
  owner: string,
  orgId?: string | null,
): Promise<string | null> {
  try {
    const organizationOwner = sharedResourceOwner(orgId);
    const resources =
      owner === SHARED_OWNER
        ? [
            ...(await resourceList(SHARED_OWNER, "skills/")),
            ...(await resourceList(WORKSPACE_OWNER, "skills/")),
          ]
        : await resourceListAccessible(owner, "skills/", { orgId });
    const sorted = resources.sort((a, b) => {
      const ownerOrder =
        (a.owner === owner
          ? 0
          : a.owner === organizationOwner
            ? 1
            : a.owner === SHARED_OWNER
              ? 2
              : a.owner === WORKSPACE_OWNER
                ? 3
                : 4) -
        (b.owner === owner
          ? 0
          : b.owner === organizationOwner
            ? 1
            : b.owner === SHARED_OWNER
              ? 2
              : b.owner === WORKSPACE_OWNER
                ? 3
                : 4);
      if (ownerOrder !== 0) return ownerOrder;
      return a.path.localeCompare(b.path);
    });
    const skillCandidates = sorted.slice(0, PROMPT_SKILL_METADATA_READ_LIMIT);
    const loaded = await Promise.all(
      skillCandidates.map(async (resource) => ({
        resource,
        full: await resourceGet(resource.id).catch(() => null),
      })),
    );
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const { resource, full } of loaded) {
      if (!full?.content) continue;
      const meta = parseSkillFrontmatter(full.content);
      if (meta.userInvocable === false) continue;
      if (!isRuntimeVisibleScope(meta.scope)) continue;
      const name = meta.name || getSkillNameFromPath(resource.path);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const scope = resourceScopeForOwner(resource.owner, owner);
      const description = compactPromptLine(
        meta.description || "(no description)",
        PROMPT_SUMMARY_DESCRIPTION_MAX_CHARS,
      );
      lines.push(
        `- \`${name}\` at resource \`${resource.path}\` (${scope}) - ${ensureSentence(description)} ${resourceToolHint(
          "read",
          `\`path: "${resource.path}"\` and \`scope: "${scope}"\` before starting a task it applies to`,
        )}`,
      );
      if (lines.length >= PROMPT_SKILL_SUMMARY_LIMIT) break;
    }
    if (lines.length === 0) return null;
    if (
      sorted.length > skillCandidates.length ||
      loaded.length > PROMPT_SKILL_SUMMARY_LIMIT
    ) {
      lines.push(
        `- ...more skills omitted from the startup summary. ${resourceToolHint("list", '`prefix: "skills/"` to inspect the full catalog')}`,
      );
    }
    return `<resource-skills>\nThe following workspace skills are available in addition to codebase skills. They may come from SQL resources, Dispatch workspace resources, or local file mode. Read a matching skill before starting a task it applies to.\n\n${lines.join("\n")}\n</resource-skills>`;
  } catch {
    return null;
  }
}

async function loadResourceIndexForPrompt(
  owner: string,
  scope: "workspace" | "shared",
): Promise<string | null> {
  try {
    const resources = (await resourceList(owner))
      .filter(
        (resource) =>
          !isSpecialPromptResourcePath(resource.path) &&
          isTextLikeResource(resource.mimeType),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    if (resources.length === 0) return null;

    const listed = resources.slice(0, SHARED_RESOURCE_INDEX_LIMIT);
    const lines: string[] = [];
    const fullResources = await Promise.all(
      listed.map((resource) => resourceGet(resource.id).catch(() => null)),
    );
    for (let index = 0; index < listed.length; index++) {
      const resource = listed[index]!;
      const full = fullResources[index];
      const summary = full?.content
        ? getResourceSummaryFromContent(full.content)
        : null;
      lines.push(`- \`${resource.path}\`${summary ? ` - ${summary}` : ""}`);
    }
    if (resources.length > listed.length) {
      lines.push(
        `- ...${resources.length - listed.length} more ${scope} resources. ${resourceToolHint(
          "list",
          `\`scope: "${scope}"\` to inspect them`,
        )}`,
      );
    }

    const label =
      scope === "workspace"
        ? "Workspace reference resources are inherited by every app and are available for company, brand, positioning, persona, product, or domain context."
        : "Shared app/organization reference resources are available for app-specific or team context.";
    return `<workspace-resources scope="${scope}">\n${label} ${resourceToolHint(
      "read",
      `\`path: <path>\` and \`scope: "${scope}"\` when a task may depend on them`,
    )} Do not assume their contents without reading the relevant file.\n\n${lines.join("\n")}\n</workspace-resources>`;
  } catch {
    return null;
  }
}

/**
 * Pre-load the agent's context: AGENTS.md (workspace/template/runtime
 * instructions), the skills index, shared LEARNINGS.md (team notes), a shared
 * resource index, and memory/MEMORY.md (personal structured memory index).
 * These all get appended to the system prompt so the agent has everything it
 * needs from the first turn.
 *
 * Six sources are layered:
 *
 *   1. `<workspace>` — AGENTS.md from the enterprise workspace core.
 *   2. `<template>` — AGENTS.md + skills index from the Vite plugin bundle.
 *   3. `<workspace>` — SQL workspace AGENTS.md and instructions/*.md.
 *      Runtime global defaults managed from Dispatch and inherited by apps.
 *   4. `<app-default>` — legacy app-wide SQL defaults.
 *   5. `<shared>` — organization AGENTS.md, instructions, and LEARNINGS.md.
 *      These are isolated by active org and override app/workspace defaults.
 *   6. `<personal>` — memory/MEMORY.md from the SQL personal scope. The
 *      current user's structured memory index.
 *
 * Each source is read independently — no copying between them. Editing
 * AGENTS.md and restarting the server is all it takes; Vite HMR invalidates
 * the bundle in dev so changes land instantly.
 */
export async function loadResourcesForPrompt(
  owner: string,
  compact = false,
  selfAppId?: string,
  orgId: string | null = getRequestOrgId() ?? null,
  opts?: { disabledFrameworkGroups?: ReadonlySet<FrameworkToolGroup> },
): Promise<string> {
  await ensurePersonalDefaults(owner);

  const sections: PromptSection[] = [];
  const addSection = (
    content: string | null | undefined,
    governance: ContextGovernanceTier = "inherited",
  ): void => {
    if (content?.trim()) sections.push({ content, governance });
  };
  const addSections = (
    blocks: string[],
    governance: ContextGovernanceTier = "inherited",
  ): void => {
    for (const block of blocks) addSection(block, governance);
  };
  const promptResourceMaxChars = compact
    ? COMPACT_PROMPT_RESOURCE_MAX_CHARS
    : SHARED_PROMPT_RESOURCE_MAX_CHARS;

  // 1. Workspace AGENTS.md + skills merged into the template bundle.
  try {
    const { loadAgentsBundle, generateSkillsPromptBlock, getRuntimeSkills } =
      await import("../agents-bundle.js");
    const bundle = await loadAgentsBundle();

    // Workspace-core AGENTS.md (enterprise-wide instructions), if present.
    if (bundle.workspaceAgentsMd && bundle.workspaceAgentsMd.trim()) {
      const block = promptResourceBlock({
        name: "AGENTS.md",
        scope: "workspace",
        path: "AGENTS.md",
        content: bundle.workspaceAgentsMd,
        maxChars: promptResourceMaxChars,
        readHint:
          'Use docs-search --slug "agents-workspace" to read the full workspace AGENTS.md.',
      });
      addSection(block, "required");
    }

    // 2. Runtime instruction file — always included when configured.
    const runtimeAgentsMd = bundle.runtimeAgentsMd ?? bundle.agentsMd;
    if (runtimeAgentsMd.trim()) {
      const block = promptResourceBlock({
        name: "AGENTS.md",
        scope: "template",
        path: "AGENTS.md",
        content: runtimeAgentsMd,
        maxChars: promptResourceMaxChars,
        readHint:
          'Use docs-search --slug "agents-template" to read the full template AGENTS.md.',
      });
      addSection(block);
    }

    // In compact mode, skip the full skills block — the agent can use
    // `docs-search` to find skills when it needs them. Either way, `scope: dev`
    // skills are excluded: they're for the human's coding agent, not runtime.
    const runtimeSkills = getRuntimeSkills(bundle);
    if (!compact) {
      const skillsBlock = generateSkillsPromptBlock(bundle);
      addSection(skillsBlock);
    } else if (runtimeSkills.length > 0) {
      const listedSkills = runtimeSkills.slice(0, PROMPT_SKILL_SUMMARY_LIMIT);
      const lines = listedSkills.map((s) => {
        const description = s.meta.description?.trim()
          ? ` - ${ensureSentence(compactPromptLine(s.meta.description, PROMPT_SUMMARY_DESCRIPTION_MAX_CHARS))}`
          : "";
        return `- \`${s.meta.name}\`${description} Read with \`docs-search --slug "${skillDocsSlug(s.meta.name)}"\` before starting a task it applies to.`;
      });
      if (runtimeSkills.length > listedSkills.length) {
        lines.push(
          `- ...${runtimeSkills.length - listedSkills.length} more codebase skills. Use \`docs-search --query "<topic>"\` to discover the relevant one.`,
        );
      }
      addSection(
        `<skills-summary>\nCodebase skills bundled from \`.agents/skills/\` (or legacy \`.agent/skills/\`) are available as docs-search pages. Do not use MCP resource reads for these skills.\n\n${lines.join("\n")}\n</skills-summary>`,
      );
    }
  } catch {}

  // 3. Runtime workspace resources. These are global defaults inherited by
  // every app in the workspace, not copied into app scopes. They may come from
  // SQL, Dispatch, or local file mode.
  const workspaceAgents = await loadAgentsResourceForPrompt(
    WORKSPACE_OWNER,
    "workspace",
    promptResourceMaxChars,
  );
  addSection(workspaceAgents, "required");
  addSections(
    await loadInstructionResourcesForPrompt(
      WORKSPACE_OWNER,
      "workspace-instruction",
      promptResourceMaxChars,
      compact,
    ),
  );

  const organizationOwner = sharedResourceOwner(orgId);

  // 4. Legacy app-wide defaults. Existing deployments keep their seeded
  // shared guidance as an inherited fallback; organization writes never
  // mutate this owner.
  const appDefaultAgents = await loadAgentsResourceForPrompt(
    SHARED_OWNER,
    organizationOwner === SHARED_OWNER ? "shared" : "app-default",
    promptResourceMaxChars,
  );
  addSection(appDefaultAgents, "required");
  addSections(
    await loadInstructionResourcesForPrompt(
      SHARED_OWNER,
      organizationOwner === SHARED_OWNER
        ? "shared-instruction"
        : "app-default-instruction",
      promptResourceMaxChars,
      compact,
    ),
  );

  // 5. Active organization resources. These are the durable team rules and
  // learnings that Slack/integration runs share with interactive app chat.
  if (organizationOwner !== SHARED_OWNER) {
    const organizationAgents = await loadAgentsResourceForPrompt(
      organizationOwner,
      "organization",
      promptResourceMaxChars,
    );
    addSection(organizationAgents, "required");
    addSections(
      await loadInstructionResourcesForPrompt(
        organizationOwner,
        "organization-instruction",
        promptResourceMaxChars,
        compact,
      ),
    );
  }

  // 6. Personal SQL resources. These come last in the instruction stack so a
  // user can narrow or override organization/app and workspace defaults.
  if (owner !== SHARED_OWNER && owner !== WORKSPACE_OWNER) {
    const personalAgents = await loadAgentsResourceForPrompt(
      owner,
      "personal",
      promptResourceMaxChars,
    );
    addSection(personalAgents, "required");
    addSections(
      await loadInstructionResourcesForPrompt(
        owner,
        "personal-instruction",
        promptResourceMaxChars,
        compact,
      ),
      "user",
    );
  }

  const resourceSkillsBlock = await loadResourceSkillsPromptBlock(owner, orgId);
  addSection(resourceSkillsBlock);

  let sharedLearnings: Awaited<ReturnType<typeof resourceGetByPath>> = null;
  try {
    sharedLearnings =
      (organizationOwner !== SHARED_OWNER
        ? await resourceGetByPath(organizationOwner, "LEARNINGS.md")
        : null) ?? (await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md"));
  } catch {}

  if (compact) {
    // Integration/Slack turns use compact context, but organization learnings
    // are operational routing input, not optional background. Preload the
    // bounded shared file so canonical destinations/fields are available on
    // the first turn; keep personal memory on-demand to preserve the compact
    // budget.
    if (sharedLearnings?.content?.trim()) {
      const block = promptResourceBlock({
        name: "LEARNINGS.md",
        scope: "shared",
        path: "LEARNINGS.md",
        content: sharedLearnings.content,
        maxChars: COMPACT_PROMPT_RESOURCE_MAX_CHARS,
      });
      addSection(block);
    }
    // The pointer to on-demand learnings/memory must survive trimming: without
    // it the agent has no way to learn those scopes exist at all.
    addSection(
      `<context-note>Organization learnings above and your personal memory (memory/MEMORY.md) are available via the \`resources\` tool. Save durable team facts and routing conventions to shared LEARNINGS.md; keep personal preferences in save-memory.</context-note>`,
      "required",
    );
  } else {
    // LEARNINGS.md from SQL (template-level instructions are in AGENTS.md
    // above). Capped like every other prompt resource — an unbounded team
    // notes file would otherwise inline in full on every non-lazy request.
    if (sharedLearnings?.content?.trim()) {
      const block = promptResourceBlock({
        name: "LEARNINGS.md",
        scope: "shared",
        path: "LEARNINGS.md",
        content: sharedLearnings.content,
        maxChars: SHARED_PROMPT_RESOURCE_MAX_CHARS,
      });
      addSection(block);
    }

    // 3. Personal memory index (skip if owner is the shared sentinel).
    // Same cap as LEARNINGS.md — a large personal MEMORY.md index must not
    // inline without bound just because this request opted out of lazy
    // context.
    if (owner !== SHARED_OWNER) {
      try {
        const memoryIndex = await resourceGetByPath(owner, "memory/MEMORY.md");
        if (memoryIndex?.content?.trim()) {
          const block = promptResourceBlock({
            name: "memory/MEMORY.md",
            scope: "personal",
            path: "memory/MEMORY.md",
            content: memoryIndex.content,
            maxChars: SHARED_PROMPT_RESOURCE_MAX_CHARS,
          });
          addSection(block, "user");
        }
      } catch {}
    }
  }

  const workspaceResourceIndex = await loadResourceIndexForPrompt(
    WORKSPACE_OWNER,
    "workspace",
  );
  addSection(workspaceResourceIndex);

  const appDefaultResourceIndex = await loadResourceIndexForPrompt(
    SHARED_OWNER,
    "shared",
  );
  addSection(appDefaultResourceIndex);
  if (organizationOwner !== SHARED_OWNER) {
    const organizationResourceIndex = await loadResourceIndexForPrompt(
      organizationOwner,
      "shared",
    );
    addSection(organizationResourceIndex);
  }

  addSections(
    await loadPromptContextProviderBlocks({
      owner,
      compact,
      selfAppId,
      orgId,
    }),
  );

  try {
    // Both tools this block names by name come from the `workspaceApps` group.
    // With that group off there is no `call-agent` to delegate through, so the
    // block would only teach a capability the request cannot carry.
    const agents = frameworkGroupEnabled(
      opts?.disabledFrameworkGroups,
      "workspaceApps",
    )
      ? (await discoverAgents(selfAppId)).slice(0, 30)
      : [];
    if (agents.length > 0) {
      const lines = agents.map(
        (agent) =>
          `- ${agent.name} (${agent.id}) — ${agent.description || "Connected A2A app"}`,
      );
      // Nothing else in the prompt or the initial tool surface tells the agent
      // which peer apps exist, so this block is not droppable: without it the
      // agent reports cross-app work as impossible instead of delegating.
      addSection(
        `<available-apps>\nWorkspace apps available over A2A/call-agent:\n${lines.join("\n")}\n\nWhen another app owns the work or data, use \`call-agent\` with the app id and a natural-language message. The receiving specialist owns source selection, schema interpretation, queries, joins, and use of its local tools. Direct action invocation is only for an explicitly read-only bounded action with a fully known schema. Never put creates, updates, deletes, sends, saves, publishes, or other side effects in direct action mode; put those objectives in the natural-language message.\n\nThese one-liners are the only cross-app detail in this prompt. Before building a capability another app may already own, before telling the user what is or is not possible across apps, and whenever the user asks which app to use, call \`describe-workspace-apps\` - it reads each peer's live agent card for current purpose and optional capability details. Never hand-maintain a list of workspace apps in code or docs; it goes stale silently.\n</available-apps>`,
        "required",
      );
    }
  } catch {
    // Agent discovery is helpful context, not required for the run.
  }

  if (sections.length === 0) return "";
  let selectedSections = sections.map((section) => section.content);
  if (compact) {
    const budget = selectPromptSectionsWithinBudget(
      sections,
      COMPACT_PROMPT_RESOURCES_TOTAL_MAX_CHARS,
    );
    selectedSections = budget.sections;
    if (budget.skipped.length > 0) {
      console.warn(
        `[agent-native] startup context exceeded the ${COMPACT_PROMPT_RESOURCES_TOTAL_MAX_CHARS.toLocaleString()}-character compact budget for ${selfAppId ?? "app"}; omitted ${budget.skipped.length} discretionary section(s): ${budget.skipped
          .map((section) => `${section.label} (${section.chars} chars)`)
          .join(", ")}`,
      );
    }
    if (budget.overflowChars > 0) {
      console.warn(
        `[agent-native] required startup context alone exceeds the compact budget by ${budget.overflowChars.toLocaleString()} characters for ${selfAppId ?? "app"}; sending it over budget rather than truncating required context. Shrink workspace-core AGENTS.md or reduce discovered workspace apps.`,
      );
    }
  }
  return (
    "\n\nThe following resources contain template-specific instructions and user context. Use the information in them to help the user.\n\n" +
    selectedSections.join("\n\n")
  );
}
