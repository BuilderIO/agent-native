import { captureOrigin } from "./capture-grants";

export const PAGE_SESSIONS_KEY = "agentNativeBrowserPageSessions";
const MAX_PAGE_SESSIONS = 64;

export interface BrowserPageSessionV1 {
  version: 1;
  handle: string;
  origin: string;
  title: string;
}

interface StoredPageSession extends BrowserPageSessionV1 {
  tabId: number;
  updatedAt: number;
}

export async function createPageSession(
  tabId: number,
  url: string,
  title: string,
): Promise<BrowserPageSessionV1> {
  const origin = captureOrigin(url);
  if (!origin)
    throw new Error("Only HTTP(S) pages can become browser sessions.");
  const sessions = await readStoredSessions();
  const existing = sessions.find(
    (session) => session.tabId === tabId && session.origin === origin,
  );
  const next: StoredPageSession = existing
    ? {
        ...existing,
        title: boundedTitle(title),
        updatedAt: Date.now(),
      }
    : {
        version: 1,
        handle: `bsn_${crypto.randomUUID()}`,
        tabId,
        origin,
        title: boundedTitle(title),
        updatedAt: Date.now(),
      };
  await writeStoredSessions([
    next,
    ...sessions.filter((session) => session.handle !== next.handle),
  ]);
  return publicSession(next);
}

export async function resolvePageSession(
  handle: unknown,
): Promise<StoredPageSession | null> {
  if (!isPageSessionHandle(handle)) return null;
  const sessions = await readStoredSessions();
  const session = sessions.find((candidate) => candidate.handle === handle);
  if (!session) return null;
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  if (!tab || captureOrigin(tab.url) !== session.origin) {
    await writeStoredSessions(
      sessions.filter((candidate) => candidate.handle !== handle),
    );
    return null;
  }
  return session;
}

export async function readCurrentPageSession(): Promise<BrowserPageSessionV1 | null> {
  const sessions = await readStoredSessions();
  return sessions[0] ? publicSession(sessions[0]) : null;
}

export async function invalidatePageSessionsForTab(
  tabId: number,
  nextUrl?: string,
): Promise<void> {
  const sessions = await readStoredSessions();
  const nextOrigin = captureOrigin(nextUrl);
  await writeStoredSessions(
    sessions.filter(
      (session) =>
        session.tabId !== tabId ||
        (nextOrigin !== null && session.origin === nextOrigin),
    ),
  );
}

export function isPageSessionHandle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 40 &&
    value.length <= 64 &&
    /^bsn_[0-9a-f-]+$/i.test(value)
  );
}

async function readStoredSessions(): Promise<StoredPageSession[]> {
  const stored = await chrome.storage.session.get(PAGE_SESSIONS_KEY);
  const value = stored[PAGE_SESSIONS_KEY];
  return Array.isArray(value)
    ? value.filter(isStoredPageSession).slice(0, MAX_PAGE_SESSIONS)
    : [];
}

async function writeStoredSessions(
  sessions: StoredPageSession[],
): Promise<void> {
  await chrome.storage.session.set({
    [PAGE_SESSIONS_KEY]: sessions.slice(0, MAX_PAGE_SESSIONS),
  });
}

function isStoredPageSession(value: unknown): value is StoredPageSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<StoredPageSession>;
  return (
    session.version === 1 &&
    isPageSessionHandle(session.handle) &&
    typeof session.tabId === "number" &&
    Number.isInteger(session.tabId) &&
    session.tabId >= 0 &&
    captureOrigin(session.origin) === session.origin &&
    typeof session.title === "string" &&
    session.title.length <= 512 &&
    typeof session.updatedAt === "number" &&
    Number.isFinite(session.updatedAt)
  );
}

function publicSession(session: StoredPageSession): BrowserPageSessionV1 {
  return {
    version: 1,
    handle: session.handle,
    origin: session.origin,
    title: session.title,
  };
}

function boundedTitle(value: string): string {
  return value.trim().slice(0, 512) || "Current page";
}
