/**
 * Pure decision logic for the `[journey]` specs.
 *
 * Everything here takes plain values and returns plain values so the verdicts
 * can be unit-tested without a browser or a session. The specs gather the
 * evidence; this file decides what counts as a failure and writes the message
 * the next engineer reads.
 */

// ── Sign-in loops (session stability) ──────────────────────────────────────

const SIGN_IN_PATH =
  /(?:^|\/)(?:_agent-native\/)?(?:sign-in|signin|login|sign-up|signup)(?:\/|$)/i;
const OAUTH_HOST = /(?:^|\.)accounts\.google\.com$/i;

export interface NavigationRecord {
  /** Which scripted step was running when the main frame navigated. */
  step: string;
  url: string;
}

/**
 * Why a main-frame navigation to `url` means a signed-in user was pushed out
 * of the app, or null when it is an ordinary in-app navigation.
 */
export function signInNavigationReason(
  url: string,
  allowedOrigins: readonly string[],
): string | null {
  if (url === "about:blank") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    return `unparseable URL (${error instanceof Error ? error.message : String(error)})`;
  }
  if (SIGN_IN_PATH.test(parsed.pathname)) return "a sign-in route";
  if (OAUTH_HOST.test(parsed.hostname)) return "Google OAuth";
  if (!allowedOrigins.includes(parsed.origin)) {
    return `an origin outside the app under test (${parsed.origin})`;
  }
  return null;
}

export function describeNavigations(
  navigations: readonly NavigationRecord[],
): string {
  if (navigations.length === 0) return "(none recorded)";
  return navigations
    .map((entry, index) => `${index + 1}. [${entry.step}] ${entry.url}`)
    .join("\n");
}

// ── Credential / credits state ─────────────────────────────────────────────

/** Copy the false "Builder credits are used up" state renders. */
const CREDIT_BLOCK_PATTERNS: readonly RegExp[] = [
  /credits? (?:are|is) used up/i,
  /\bUpgrade plan\b/,
];

/** Copy that says AI cannot run until a connection is made. */
const CONNECT_BLOCK_PATTERNS: readonly RegExp[] = [
  /Connect AI above to continue/i,
  /No LLM provider is connected/i,
  /Connect Builder\.io to (?:continue|use|start|run)/i,
];

export interface BlockingText {
  credits: string[];
  connect: string[];
}

function matchingLines(text: string, patterns: readonly RegExp[]): string[] {
  const hits = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && patterns.some((pattern) => pattern.test(trimmed))) {
      hits.add(trimmed.slice(0, 160));
    }
  }
  return [...hits];
}

export function findBlockingText(visibleText: string): BlockingText {
  return {
    credits: matchingLines(visibleText, CREDIT_BLOCK_PATTERNS),
    connect: matchingLines(visibleText, CONNECT_BLOCK_PATTERNS),
  };
}

export type ComposerState = "usable" | "disabled" | "absent";

export interface CredentialEvidence {
  app: string;
  composer: ComposerState;
  visibleText: string;
  /** `configured` from /_agent-native/agent-engine/status; null when unreadable. */
  engineConfigured: boolean | null;
  /** `exhausted` from get-builder-credit-status; null when unreadable. */
  creditExhausted: boolean | null;
  /** Apps where the e2e account is expected to have an AI provider. */
  composerRequired: boolean;
}

/**
 * Contradictions between what the credential APIs say and what the UI shows.
 * An empty list means the two agree.
 */
export function diagnoseCredentialState(
  evidence: CredentialEvidence,
): string[] {
  const problems: string[] = [];
  const text = findBlockingText(evidence.visibleText);

  if (text.credits.length > 0) {
    if (evidence.creditExhausted !== true) {
      problems.push(
        `a "credits are used up" / "Upgrade plan" notice is on screen (${JSON.stringify(text.credits)}) but get-builder-credit-status reports exhausted=${String(evidence.creditExhausted)}. This is the false-credits state users reported.`,
      );
    } else if (evidence.composer !== "usable") {
      problems.push(
        `the Builder credits really are exhausted for this account (get-builder-credit-status exhausted=true) and the composer is ${evidence.composer}, so the e2e identity cannot chat. Top up or disconnect Builder for the e2e account.`,
      );
    }
  }
  if (evidence.composer === "usable" && text.connect.length > 0) {
    problems.push(
      `the composer is usable yet a connect-AI blocker is on screen (${JSON.stringify(text.connect)}). The state contradicts itself.`,
    );
  }
  if (evidence.engineConfigured === true && evidence.composer === "disabled") {
    problems.push(
      "agent-engine/status says an AI provider is configured but the composer is disabled. The UI is reporting a connection problem the server does not have.",
    );
  }
  if (evidence.engineConfigured === true && text.connect.length > 0) {
    problems.push(
      `agent-engine/status says an AI provider is configured but the page shows a connect blocker (${JSON.stringify(text.connect)}).`,
    );
  }
  if (evidence.composerRequired && evidence.composer === "absent") {
    problems.push(
      "no agent composer rendered on an app where the e2e account has an AI provider, so there is nothing for the user to type into.",
    );
  }
  if (evidence.composerRequired && evidence.engineConfigured === false) {
    problems.push(
      'agent-engine/status reports no AI provider for the e2e account, but the chat lane installs one on this app. Either the chat lane has never run on this host, or the stored credential is no longer resolved (the "no keys connected" report).',
    );
  }
  return problems;
}

export interface BuilderConnectionEvidence {
  /** `configured` from /_agent-native/connection-status/builder. */
  configured: boolean;
  /** `effective` from the same response; null when no connection is in effect. */
  effective: string | null;
  /** Visible text of Settings › Integrations › Builder.io. */
  settingsText: string;
  /** Visible text of the app chrome and the opened account menu. */
  chromeText: string;
  creditExhausted: boolean | null;
}

/**
 * Where the Builder connection section, the account chrome, and the server's
 * own status disagree. Empty means they tell one story.
 */
export function builderConnectionDisagreements(
  evidence: BuilderConnectionEvidence,
): string[] {
  const out: string[] = [];
  const connectedMarker =
    /\b(?:Disconnect|Reconnect|Connected)\b|Needs to be reconnected/.test(
      evidence.settingsText,
    );
  const disconnectOffered = /\bDisconnect\b/.test(evidence.settingsText);

  if (evidence.configured && !connectedMarker) {
    out.push(
      `connection-status/builder says configured=true (effective=${String(evidence.effective)}) but Settings › Integrations › Builder.io shows no Connected/Reconnect/Disconnect state.`,
    );
  }
  if (
    !evidence.configured &&
    evidence.effective === null &&
    disconnectOffered
  ) {
    out.push(
      "connection-status/builder says no Builder connection exists but Settings › Integrations › Builder.io offers Disconnect.",
    );
  }

  const creditNotice = findBlockingText(evidence.chromeText).credits;
  if (creditNotice.length > 0) {
    if (!evidence.configured) {
      out.push(
        `the app chrome shows a Builder credits notice (${JSON.stringify(creditNotice)}) although connection-status/builder says no Builder connection exists.`,
      );
    } else if (evidence.creditExhausted !== true) {
      out.push(
        `the app chrome shows a Builder credits notice (${JSON.stringify(creditNotice)}) but get-builder-credit-status reports exhausted=${String(evidence.creditExhausted)}.`,
      );
    }
  }
  return out;
}

// ── Design systems stuck indexing ──────────────────────────────────────────

export interface DesignSystemRow {
  id: string;
  title?: string;
  /** JSON string (the stored column) or the already-parsed object. */
  data?: unknown;
  docCount?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  ownerEmail?: unknown;
}

export interface StuckDesignSystem {
  id: string;
  title: string;
  owner: string;
  ageHours: number;
  createdAt: string;
  updatedAt: string;
  builderStatus: string;
  docCount: number;
}

export interface DesignSystemIndexingReport {
  total: number;
  builderBacked: number;
  indexed: number;
  stuck: StuckDesignSystem[];
  /** Rows whose state could not be read; unreadable is not "fine". */
  unreadable: { id: string; reason: string }[];
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && /^\d{10,}$/.test(value.trim())) {
      return asNumber;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseRowData(
  data: unknown,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ok: true, value: data as Record<string, unknown> };
  }
  if (typeof data !== "string") {
    return { ok: false, reason: `data is ${typeof data}, not a JSON string` };
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return { ok: false, reason: "data JSON is not an object" };
  } catch (error) {
    return {
      ok: false,
      reason: `data is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/**
 * A Builder-backed design system is usable once its document count is above
 * zero (the same rule the Design app applies in `isDesignSystemUsableForGeneration`).
 * One that is still not usable long after it was created is stuck indexing,
 * which is what users see as "every design system is indexing".
 */
export function findStuckDesignSystems(
  rows: readonly DesignSystemRow[],
  nowMs: number,
  stuckAfterMs: number,
): DesignSystemIndexingReport {
  const report: DesignSystemIndexingReport = {
    total: rows.length,
    builderBacked: 0,
    indexed: 0,
    stuck: [],
    unreadable: [],
  };
  for (const row of rows) {
    const data = parseRowData(row.data);
    if (!data.ok) {
      report.unreadable.push({ id: row.id, reason: data.reason });
      continue;
    }
    if (data.value.source !== "builder") continue;
    report.builderBacked += 1;

    const docCount =
      typeof row.docCount === "number"
        ? row.docCount
        : typeof data.value.docCount === "number"
          ? data.value.docCount
          : 0;
    if (docCount > 0) {
      report.indexed += 1;
      continue;
    }

    const createdAt = parseTimestamp(row.createdAt);
    if (createdAt === null) {
      report.unreadable.push({
        id: row.id,
        reason: `createdAt ${JSON.stringify(row.createdAt)} is not a timestamp`,
      });
      continue;
    }
    const ageMs = nowMs - createdAt;
    if (ageMs <= stuckAfterMs) continue;
    const updatedAt = parseTimestamp(row.updatedAt);
    report.stuck.push({
      id: row.id,
      title: row.title ?? "(untitled)",
      owner: typeof row.ownerEmail === "string" ? row.ownerEmail : "(unknown)",
      ageHours: Math.round(ageMs / 360_000) / 10,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt:
        updatedAt === null ? "(unknown)" : new Date(updatedAt).toISOString(),
      builderStatus:
        typeof data.value.builderStatus === "string"
          ? data.value.builderStatus
          : "(none)",
      docCount,
    });
  }
  return report;
}

// ── Dispatch workspace apps and lanes ──────────────────────────────────────

export type Lane = "beta" | "production" | "other";

export function laneOf(host: string): Lane {
  const normalized = host.trim().toLowerCase();
  if (/^beta\./.test(normalized)) return "beta";
  if (/(?:^|\.)agent-native\.com$/.test(normalized)) return "production";
  return "other";
}

export interface WorkspaceAppLike {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  archived?: unknown;
  isDispatch?: unknown;
}

export interface OpenableApp {
  id: string;
  name: string;
}

/** Ready, visible, non-Dispatch apps, in listed order, capped. */
export function pickOpenableApps(
  apps: readonly WorkspaceAppLike[],
  cap: number,
): OpenableApp[] {
  const seen = new Set<string>();
  const picked: OpenableApp[] = [];
  for (const app of apps) {
    if (typeof app.id !== "string" || !app.id.trim()) continue;
    if (app.archived === true || app.isDispatch === true) continue;
    if (app.status === "pending") continue;
    const id = app.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push({
      id,
      name: typeof app.name === "string" && app.name ? app.name : id,
    });
    if (picked.length >= cap) break;
  }
  return picked;
}

/** True when `a` and `b` are both known lanes and differ. */
export function crossedLanes(fromHost: string, toHost: string): boolean {
  const from = laneOf(fromHost);
  const to = laneOf(toHost);
  return from !== "other" && to !== "other" && from !== to;
}

const NOT_FOUND_TEXT =
  /\b404\b|page not found|app not found|this page could not be found|page could not be found/i;

/** Whether the start of a page's text is a not-found screen. */
export function looksLikeNotFound(visibleText: string): boolean {
  return NOT_FOUND_TEXT.test(visibleText.trim().slice(0, 400));
}
