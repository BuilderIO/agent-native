/**
 * The one place that maps today's Settings links onto the redesigned pages.
 *
 * Every legacy form (tab ids, nested `a:b:c` ids, section hashes, `#secrets:KEY`,
 * `agent-panel:open-settings` sections) resolves here, so links in templates,
 * OAuth callbacks, and sent emails keep landing on the right page. Targets are
 * the spec's page ids, not where a page's content sits while its page task is
 * still pending.
 */

/**
 * Stable page ids. They are URL segments (`/settings/:page/:sub`), search
 * targets, and the agent's name for a page, so never rename one; add a
 * redirect instead.
 */
export const SETTINGS_PAGE_IDS = {
  profile: "profile",
  preferences: "preferences",
  security: "security",
  integrations: "integrations",
  apiKeys: "api-keys",
  model: "model",
  instructions: "instructions",
  memory: "memory",
  skills: "skills",
  files: "files",
  subAgents: "sub-agents",
  org: "org",
  members: "members",
  usage: "usage",
  auth: "auth",
  apps: "apps",
  infra: "infra",
  audit: "audit",
  app: "app",
  notifications: "notifications",
  automations: "automations",
  channels: "channels",
  mcp: "mcp",
  creativeContext: "creative-context",
  labs: "labs",
  whatsNew: "whats-new",
} as const;

export type CoreSettingsPageId =
  (typeof SETTINGS_PAGE_IDS)[keyof typeof SETTINGS_PAGE_IDS];

export const CORE_SETTINGS_PAGE_ID_LIST: readonly CoreSettingsPageId[] =
  Object.values(SETTINGS_PAGE_IDS);

const CORE_PAGE_IDS = new Set<string>(CORE_SETTINGS_PAGE_ID_LIST);

export function isCoreSettingsPageId(id: string): id is CoreSettingsPageId {
  return CORE_PAGE_IDS.has(id);
}

/**
 * Application-state key, scoped to the browser tab, for the Settings page the
 * user has open. Absent when Settings isn't open in that tab.
 */
export const SETTINGS_VIEW_STATE_KEY = "settings-view";

export interface SettingsViewState {
  page: string;
  sub: string | null;
  /** "Group › Page" in the viewer's language. */
  label: string | null;
}

/**
 * The `<current-url>` line that names the open Settings page, or null when
 * the stored value isn't one (a stale or foreign row must not read as a page).
 */
export function describeSettingsViewForAgent(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { page, sub, label } = value as Partial<SettingsViewState>;
  if (typeof page !== "string" || !page) return null;
  const path = typeof sub === "string" && sub ? `${page}/${sub}` : page;
  return `settingsPage: ${path}${typeof label === "string" && label ? ` (${label})` : ""}`;
}

export interface SettingsRedirect {
  page: string;
  sub?: string;
  /** In-page target: a `SettingsRow`/`SettingsGroup` id, a section id, or `secrets:KEY`. */
  anchor?: string;
  /** Opened instead when this app has no `page`. */
  fallbackPage?: string;
}

/** Old section spellings the settings panels still accept. */
export const SETTINGS_SECTION_ALIASES: Readonly<Record<string, string>> = {
  "agent-engine": "llm",
  "agent-model-defaults": "app-models",
  "app-model-defaults": "app-models",
  models: "app-models",
  "agent-limits": "limits",
  "loop-settings": "limits",
};

/**
 * Section ids: `agent-panel:open-settings` sections and the section hashes
 * today's panels scroll to. Section redirects keep the section id as the
 * anchor, which is what the bridged panels open and the shell flashes.
 */
const SECTION_REDIRECTS: Readonly<Record<string, SettingsRedirect>> = {
  account: { page: "profile" },
  llm: { page: "model", anchor: "llm" },
  "app-models": { page: "app", anchor: "app-models" },
  limits: { page: "model", anchor: "limits" },
  voice: { page: "preferences", anchor: "voice" },
  "demo-mode": { page: "app", anchor: "demo-mode" },
  automations: { page: "automations" },
  secrets: { page: "api-keys" },
  hosting: { page: "infra", anchor: "hosting" },
  database: { page: "infra", anchor: "database" },
  uploads: { page: "infra", anchor: "uploads" },
  auth: { page: "auth", anchor: "sign-in-methods" },
  // Spec open question 5: an email channel belongs in Channels.
  email: { page: "channels", anchor: "email" },
  browser: { page: "integrations", sub: "builder" },
  background: { page: "infra", anchor: "background" },
  integrations: { page: "integrations" },
  connections: { page: "integrations" },
  usage: { page: "usage" },
  a2a: { page: "sub-agents", anchor: "external-agents" },
  organization: { page: "org" },
  org: { page: "org" },
  "workspace-settings": { page: "org" },
};

/** Today's `SettingsTabItem` ids and nested ids (URL segments joined by `:`). */
const TAB_REDIRECTS: Readonly<Record<string, SettingsRedirect>> = {
  general: { page: "app" },
  account: { page: "profile" },
  language: { page: "preferences" },
  agent: { page: "model" },
  "agent:overview": { page: "model" },
  providers: { page: "model" },
  "agent:resources": { page: "files" },
  "agent:resources:files": { page: "files" },
  "agent:resources:instructions": { page: "instructions" },
  "agent:resources:memory": { page: "memory" },
  "agent:resources:learnings": { page: "memory", anchor: "learnings" },
  "agent:resources:skills": { page: "skills" },
  "agent:resources:agents": { page: "sub-agents", anchor: "custom-agents" },
  "agent:resources:remote-agents": {
    page: "sub-agents",
    anchor: "external-agents",
  },
  "agent:agents": { page: "sub-agents", anchor: "external-agents" },
  "agent:directory": { page: "sub-agents", anchor: "external-agents" },
  "agent:automations": { page: "automations" },
  connections: { page: "integrations" },
  browser: { page: "integrations", sub: "builder" },
  organization: { page: "org" },
  team: { page: "members" },
  workspace: { page: "infra" },
  // Only apps that pass `extensionTools` (forms, plan, tasks) have the page.
  extensions: { page: "extensions", fallbackPage: "app" },
  library: { page: "creative-context" },
  experiments: { page: "labs" },
  "labs:experiments": { page: "labs" },
  changelog: { page: "whats-new" },
  updates: { page: "whats-new" },
  "what-s-new": { page: "whats-new" },
};

// Key names keep their case, so this runs before ids are lowercased.
const SECRET_KEY_PATTERN = /^(?:integrations:)?(?:secrets|keys)(?::(.+))?$/i;
const LAB_PATTERN = /^(?:labs:)?(?:experiments:)?(?:experiment-|lab-)(.+)$/;

export function normalizeSettingsId(value: string): string {
  return value
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_]+/g, "-");
}

function sectionRedirect(id: string): SettingsRedirect | undefined {
  return SECTION_REDIRECTS[SETTINGS_SECTION_ALIASES[id] ?? id];
}

/** True when `id` (or its old spelling) is a section the settings panels open. */
export function isSettingsSectionId(id: string): boolean {
  return sectionRedirect(normalizeSettingsId(id)) !== undefined;
}

/**
 * `secrets:KEY` and `labs:lab-x` style ids. They nest under ids that are also
 * new pages (`integrations/secrets/KEY`), so routing checks them before a
 * page id match.
 */
export function resolveSettingsIdPattern(
  value: string,
): SettingsRedirect | null {
  const raw = value.trim().replace(/^#/, "");
  const secret = SECRET_KEY_PATTERN.exec(raw);
  if (secret) {
    const key = secret[1]?.trim();
    return key
      ? { page: "api-keys", anchor: `secrets:${key}` }
      : { page: "api-keys" };
  }
  const lab = LAB_PATTERN.exec(normalizeSettingsId(raw));
  return lab ? { page: "labs", anchor: `lab-${lab[1]}` } : null;
}

/**
 * The page a legacy id names, or `null` when it names none. `kind` decides
 * which meaning wins where a tab id and a section id collide: a hash on bare
 * `/settings` (or an agent-panel section) was a section, a path segment was a
 * tab. New page ids are not resolved here; callers check them first.
 */
export function resolveLegacySettingsId(
  value: string,
  kind: "tab" | "section" = "tab",
): SettingsRedirect | null {
  if (!value.trim().replace(/^#/, "")) return null;
  const pattern = resolveSettingsIdPattern(value);
  if (pattern) return pattern;
  const id = normalizeSettingsId(value);
  const direct =
    kind === "section"
      ? (sectionRedirect(id) ?? TAB_REDIRECTS[id])
      : (TAB_REDIRECTS[id] ?? sectionRedirect(id));
  if (direct) return direct;
  const segments = id.split(":").filter(Boolean);
  if (segments[0] === "agent" && segments.length === 2) {
    const section = sectionRedirect(segments[1]!);
    if (section) return section;
  }
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const prefix = TAB_REDIRECTS[segments.slice(0, length).join(":")];
    if (prefix) return prefix;
  }
  return null;
}

/**
 * Where an `agent-panel:open-settings` request lands. A request with no
 * section falls back to the hash its caller set first (`#agent-limits`,
 * `#llm`), and anything unrecognized opens Model, as today's `#agent` did.
 */
export function resolveSettingsSectionRedirect(
  section?: string | null,
  currentHash?: string | null,
): SettingsRedirect {
  const hash = currentHash?.trim().replace(/^#/, "") ?? "";
  const requested = section?.trim().replace(/^#/, "") ?? "";
  if (
    normalizeSettingsId(requested) === "secrets" &&
    /^secrets:.+/i.test(hash)
  ) {
    return resolveLegacySettingsId(hash, "section")!;
  }
  const target =
    (requested && resolveLegacySettingsId(requested, "section")) ||
    (!requested && hash ? resolveLegacySettingsId(hash, "section") : null);
  if (target) return target;
  if (requested && isCoreSettingsPageId(normalizeSettingsId(requested))) {
    return { page: normalizeSettingsId(requested) };
  }
  return { page: SETTINGS_PAGE_IDS.model };
}

/**
 * Today's tab ids that show a page, best first. The flag-off Settings uses
 * this so a link built from a new page id still opens the closest tab.
 */
export function legacySettingsTabIdsForPage(
  page: string,
  sub?: string | null,
): readonly string[] {
  switch (normalizeSettingsId(page)) {
    case "profile":
    case "security":
      return ["account"];
    case "preferences":
      return ["general"];
    case "integrations":
    case "channels":
      return ["integrations", "connections"];
    case "api-keys":
      return ["keys", "secrets"];
    case "model":
      return ["agent"];
    case "instructions":
    case "memory":
    case "skills":
    case "files":
      return ["agent:resources"];
    case "sub-agents":
      return ["agent:agents"];
    case "org":
    case "members":
    case "apps":
    case "audit":
      return ["organization", "team"];
    case "auth":
    case "infra":
      return ["workspace"];
    case "app":
      return sub ? [sub, "general"] : ["general"];
    case "automations":
      return ["agent:automations"];
    case "creative-context":
      return ["library"];
    case "usage":
    case "notifications":
    case "mcp":
    case "labs":
    case "whats-new":
      return [normalizeSettingsId(page)];
    default:
      return [];
  }
}
