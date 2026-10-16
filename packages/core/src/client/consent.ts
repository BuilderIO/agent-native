import {
  CONSENT_COOKIE_LIFETIME_SECONDS,
  CONSENT_COOKIE_NAME,
  CONSENT_PATH,
  CONSENT_REGION_PATH,
  consentCookieDomain,
  isConsentRegionTimeZone,
  parseConsent,
  serializeConsent,
  type ConsentCategory,
  type ConsentChoice,
  type ConsentRegion,
} from "../shared/consent.js";
import { agentNativePath } from "./api-path.js";
import { agentNativeApiDisabledReason } from "./api-surface.js";

export type { ConsentCategory, ConsentChoice, ConsentRegion };

/** Strictly necessary for the banner: which region this session is in. */
const REGION_STORAGE_KEY = "an_consent_region";
/**
 * Scripts that run before this module loads, like the Google tags the server
 * injects into the page, queue `[category, run]` here.
 */
const SCRIPT_QUEUE_KEY = "__AN_CONSENT_QUEUE__";

interface Waiter {
  category: ConsentCategory;
  run: () => void;
  revoke?: () => void;
  ran: boolean;
}

interface ConsentState {
  region: ConsentRegion | null;
  regionPromise: Promise<ConsentRegion> | null;
  waiters: Waiter[];
  listeners: Set<() => void>;
  settingsOpen: boolean;
}

// One state per page, however many copies of this module a bundle carries.
const STATE_KEY = Symbol.for("agent-native.client.consent");

function state(): ConsentState {
  const holder = globalThis as Record<symbol, ConsentState | undefined>;
  return (holder[STATE_KEY] ??= {
    region: null,
    regionPromise: null,
    waiters: [],
    listeners: new Set(),
    settingsOpen: false,
  });
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const part of document.cookie ? document.cookie.split(";") : []) {
      const eq = part.indexOf("=");
      if (eq !== -1 && part.slice(0, eq).trim() === name) {
        return part.slice(eq + 1).trim();
      }
    }
  } catch {
    // coercion-ok: a sandboxed iframe can't read cookies, so it holds no
    // choice and the visitor is asked.
  }
  return null;
}

/** The visitor's stored choice, or `null` before they've made one. */
export function getConsentChoice(): ConsentChoice | null {
  return parseConsent(readCookie(CONSENT_COOKIE_NAME));
}

function cookieDomain(): string {
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const domain = consentCookieDomain(host);
  return domain ? `; domain=${domain}` : "";
}

/**
 * Safari keeps a cookie page JavaScript wrote for seven days at most, so the
 * server writes the choice again for its full year.
 */
function storeChoiceOnServer(choice: ConsentChoice): void {
  if (agentNativeApiDisabledReason() || typeof fetch !== "function") return;
  void fetch(agentNativePath(CONSENT_PATH), {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice: serializeConsent(choice) }),
  }).catch(() => {
    // coercion-ok: the browser's own copy still holds the choice, for seven
    // days in Safari; the visitor is asked again after that.
  });
}

function readCachedRegion(): ConsentRegion | null {
  try {
    const value = window.sessionStorage.getItem(REGION_STORAGE_KEY);
    return value === "consent" || value === "none" ? value : null;
  } catch {
    // coercion-ok: without session storage the region is asked again.
    return null;
  }
}

function cacheRegion(region: ConsentRegion): void {
  try {
    window.sessionStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // coercion-ok: without session storage the region is asked again.
  }
}

function timeZoneRegion(): ConsentRegion {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isConsentRegionTimeZone(timeZone) ? "consent" : "none";
  } catch {
    // An unreadable zone could be anywhere, so it gets the banner.
    return "consent";
  }
}

async function fetchRegion(): Promise<ConsentRegion> {
  if (agentNativeApiDisabledReason() || typeof fetch !== "function") {
    return timeZoneRegion();
  }
  try {
    const response = await fetch(agentNativePath(CONSENT_REGION_PATH), {
      credentials: "same-origin",
    });
    const body = response.ok
      ? ((await response.json()) as { region?: string })
      : {};
    if (body.region === "consent" || body.region === "none") {
      return body.region;
    }
  } catch {
    // coercion-ok: with no answer from the server, the time zone decides.
  }
  return timeZoneRegion();
}

/**
 * Whether this visitor gets the banner: the server's answer from the
 * request's country, else the browser's time zone. Asked once a session.
 */
export function resolveConsentRegion(): Promise<ConsentRegion> {
  const current = state();
  if (current.region) return Promise.resolve(current.region);
  const cached = typeof window === "undefined" ? null : readCachedRegion();
  if (cached) {
    current.region = cached;
    return Promise.resolve(cached);
  }
  return (current.regionPromise ??= fetchRegion().then((region) => {
    current.region = region;
    cacheRegion(region);
    settle();
    notify();
    return region;
  }));
}

/** The best answer available now, without waiting for the server. */
function regionGuess(): ConsentRegion {
  const current = state();
  return current.region ?? readCachedRegion() ?? timeZoneRegion();
}

function allows(category: ConsentCategory, region: ConsentRegion | null) {
  const choice = getConsentChoice();
  if (choice) return choice[category];
  return region === "none";
}

function settle(): void {
  const region = state().region;
  for (const waiter of state().waiters) {
    const allowed = allows(waiter.category, region);
    if (allowed && !waiter.ran) {
      waiter.ran = true;
      waiter.run();
    } else if (!allowed && region) {
      // Also clears what an earlier page stored before the banner existed.
      waiter.ran = false;
      waiter.revoke?.();
    }
  }
}

function notify(): void {
  for (const listener of state().listeners) listener();
}

export interface WhenConsentAllowsOptions {
  /**
   * Run now on the time zone's guess instead of waiting for the server, and
   * call `revoke` if the server or the visitor then says no. Only for storage
   * `revoke` can fully undo; a third-party script can't be unloaded.
   */
  optimistic?: boolean;
  revoke?: () => void;
}

/**
 * Run `run` once `category` is allowed: at once outside the consent region,
 * and inside it when the visitor accepts. A later "reject" calls `revoke`.
 */
export function whenConsentAllows(
  category: ConsentCategory,
  run: () => void,
  options: WhenConsentAllowsOptions = {},
): void {
  if (typeof window === "undefined") return;
  const waiter: Waiter = { category, run, revoke: options.revoke, ran: false };
  state().waiters.push(waiter);
  const region =
    state().region ??
    readCachedRegion() ??
    (options.optimistic ? regionGuess() : null);
  if (allows(category, region)) {
    waiter.ran = true;
    run();
  }
  if (!state().region) void resolveConsentRegion();
}

/** Store the visitor's choice for every app on this site, and apply it. */
export function setConsentChoice(choice: ConsentChoice): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie =
      `${CONSENT_COOKIE_NAME}=${serializeConsent(choice)}; path=/; ` +
      `max-age=${CONSENT_COOKIE_LIFETIME_SECONDS}; SameSite=Lax${cookieDomain()}`;
  } catch {
    // coercion-ok: a sandboxed iframe can't store the choice; it still
    // applies to this page.
  }
  storeChoiceOnServer(choice);
  state().settingsOpen = false;
  if (!state().region) state().region = "consent";
  settle();
  notify();
}

/** Reopen the banner so the visitor can change their choice. */
export function openConsentSettings(): void {
  state().settingsOpen = true;
  notify();
}

/** Whether the banner should show now, for the banner component. */
export function shouldShowConsentBanner(): boolean {
  const current = state();
  if (current.settingsOpen) return true;
  return current.region === "consent" && !getConsentChoice();
}

export function subscribeConsent(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}

type QueuedScript = [ConsentCategory, () => void];

/** Run the scripts the page queued before this module loaded. */
function drainScriptQueue(): void {
  if (typeof window === "undefined") return;
  const holder = window as unknown as Record<string, unknown>;
  const queued = holder[SCRIPT_QUEUE_KEY];
  const push = (...entries: QueuedScript[]) => {
    for (const [category, run] of entries) whenConsentAllows(category, run);
    return 0;
  };
  holder[SCRIPT_QUEUE_KEY] = { push };
  if (Array.isArray(queued)) push(...(queued as QueuedScript[]));
}

drainScriptQueue();
