import {
  firstSessionReadAnswer,
  subscribeFirstSessionReadAnswer,
} from "@agent-native/core/client/use-session";
import {
  hashKey,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

// A page open starts its reads before the component that shows them mounts:
// at load before the session is known, in the layout while the route loads,
// or on /home while the landing resolves. The mounting component adopts a read made for its open instead of
// refetching. A read that was spoiled, failed, cancelled, expired, or already
// adopted is never adopted, so any other mount still reads fresh.
export const PAGE_OPEN_READ_TTL_MS = 10_000;

export type PageOpenRead = {
  documentId: string;
  startedAt: number;
  // Spoiled by an invalidation, a peer change arriving through sync, or this
  // tab saving the page, from the moment the read starts until its adopting
  // component has mounted.
  invalidated: boolean;
  // Set only by a fetch's own success. A cache write (`setQueryData`) is a
  // manual success and never counts: a read cancelled by an optimistic update
  // leaves the older cached body behind with a fresh timestamp.
  landed: boolean;
  // Sent before the session was known, with whatever account the cookies
  // named then. Cleared once the load's first session read answers for it.
  beforeSession: boolean;
};

export type PageOpenReadAdoption = "fresh" | "pending" | "none";

const readsByClient = new WeakMap<QueryClient, Map<string, PageOpenRead>>();

// Reads sent before the session was known, claimed or not, until the load's
// first session read answers: they are kept when it does, and dropped when a
// retry or an invalidation answers instead. Each waits on the answer, so the
// claim does not have to.
type HeldForSession = {
  reads: Map<string, { queryKey: QueryKey; read: PageOpenRead }>;
  whenKept: Array<() => void>;
  unsubscribe: () => void;
};
const heldByClient = new WeakMap<QueryClient, HeldForSession>();

function holdForSession(queryClient: QueryClient): HeldForSession {
  let held = heldByClient.get(queryClient);
  if (!held) {
    const created: HeldForSession = {
      reads: new Map(),
      whenKept: [],
      unsubscribe: subscribeFirstSessionReadAnswer(() =>
        settleHeldReads(queryClient),
      ),
    };
    heldByClient.set(queryClient, created);
    held = created;
  }
  return held;
}

// Runs before the app behind the session gate is shown: the session store
// calls it in the task that answers, ahead of its own subscribers.
function settleHeldReads(queryClient: QueryClient) {
  const answer = firstSessionReadAnswer();
  if (answer === "pending") return;
  const held = heldByClient.get(queryClient);
  if (!held) return;
  heldByClient.delete(queryClient);
  held.unsubscribe();
  if (answer === "first-read") {
    for (const { read } of held.reads.values()) read.beforeSession = false;
    for (const kept of held.whenKept) kept();
    return;
  }
  dropReadsBeforeSession(queryClient, held);
}

// Runs `callback` once the load's first session read keeps the reads sent
// before it, and never if another read answers instead. Once the session is
// known, a read sent now is like any other, so it runs at once.
export function whenReadsBeforeSessionKept(
  queryClient: QueryClient,
  callback: () => void,
) {
  if (firstSessionReadAnswer() === "pending") {
    holdForSession(queryClient).whenKept.push(callback);
  } else {
    callback();
  }
}

// Whether this read went out before the session was known and the load's
// first session read has not answered yet. It may hold another account's
// page, so nothing may be shown from it until that read answers.
export function isAwaitingSession(read: PageOpenRead | null) {
  return read?.beforeSession === true && firstSessionReadAnswer() === "pending";
}

function openReads(queryClient: QueryClient) {
  let reads = readsByClient.get(queryClient);
  if (!reads) {
    reads = new Map();
    readsByClient.set(queryClient, reads);
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "removed") {
        reads!.delete(event.query.queryHash);
        return;
      }
      if (event.type !== "updated") return;
      const read = reads!.get(event.query.queryHash);
      if (!read) return;
      if (event.action.type === "invalidate") read.invalidated = true;
      if (event.action.type === "success" && event.action.manual !== true) {
        read.landed = true;
      }
    });
  }
  return reads;
}

// Returns whether it started a read; one made for this open already counts.
export function startPageOpenRead<TData>(
  queryClient: QueryClient,
  documentId: string,
  options: FetchQueryOptions<TData, Error, TData, QueryKey>,
  {
    beforeSession = false,
    startedAt = Date.now(),
  }: { beforeSession?: boolean; startedAt?: number } = {},
): boolean {
  const reads = openReads(queryClient);
  const queryHash = hashKey(options.queryKey);
  const current = reads.get(queryHash);
  if (
    current &&
    !current.invalidated &&
    Date.now() - current.startedAt < PAGE_OPEN_READ_TTL_MS
  ) {
    return false;
  }
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: options.queryKey, exact: true });
  // A fetch already in flight may predate this open, or be a spoiled earlier
  // read; the new read must not join it. Cancelling reverts the query at once.
  if (query && query.state.fetchStatus !== "idle") {
    void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
  }
  // An already-invalidated query dispatches no further invalidate events, so
  // clear the flag before this read replaces its data; otherwise a change that
  // lands while the read is in flight would go unnoticed.
  if (query?.state.isInvalidated) {
    query.setState({ ...query.state, isInvalidated: false });
  }
  // Once the session has answered, a read sent now carries the cookies
  // that answer belongs to, like any other read.
  const heldForSession =
    beforeSession && firstSessionReadAnswer() === "pending";
  const read: PageOpenRead = {
    documentId,
    startedAt,
    invalidated: false,
    landed: false,
    beforeSession: heldForSession,
  };
  reads.set(queryHash, read);
  if (heldForSession) {
    holdForSession(queryClient).reads.set(queryHash, {
      queryKey: options.queryKey,
      read,
    });
  }
  void queryClient.prefetchQuery({ ...options, staleTime: 0 });
  return true;
}

export function isPageOpenRead(queryClient: QueryClient, queryKey: QueryKey) {
  return openReads(queryClient).has(hashKey(queryKey));
}

// Claims the read made for this open. A claimed read stays tracked until
// `releasePageOpenRead`, so a change that arrives before the claiming
// component subscribes still spoils it.
export function claimPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): { adoption: PageOpenReadAdoption; read: PageOpenRead | null } {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  const read = reads.get(queryHash);
  if (!read) return { adoption: "none", read: null };
  // Settled reads were already kept or dropped; one still held is adopted,
  // and the session's answer decides it before anything shows it.
  if (read.beforeSession && firstSessionReadAnswer() === "replaced") {
    settleHeldReads(queryClient);
    reads.delete(queryHash);
    void queryClient.resetQueries({ queryKey, exact: true });
    return { adoption: "none", read: null };
  }
  const query = queryClient.getQueryCache().get(queryHash);
  const usable =
    !!query &&
    !read.invalidated &&
    !query.state.isInvalidated &&
    Date.now() - read.startedAt < PAGE_OPEN_READ_TTL_MS;
  const adoption: PageOpenReadAdoption = !query
    ? "none"
    : query.state.fetchStatus !== "idle"
      ? usable
        ? "pending"
        : "none"
      : usable && read.landed
        ? "fresh"
        : "none";
  if (adoption === "none") {
    reads.delete(queryHash);
    // Until the open's own read lands, the fetch in flight is that read, and
    // it may predate the change that spoiled it. A later fetch is left alone.
    if (query && query.state.fetchStatus !== "idle" && !read.landed) {
      void queryClient.cancelQueries({ queryKey, exact: true });
    }
    return { adoption, read: null };
  }
  return { adoption, read };
}

// The session that answered is not the one the load asked alongside these
// reads, so they may hold another account's page or draft. None of them is
// shown, and a component already holding one reads it again.
function dropReadsBeforeSession(
  queryClient: QueryClient,
  held: HeldForSession,
) {
  const reads = openReads(queryClient);
  for (const [queryHash, { queryKey, read }] of held.reads) {
    if (reads.get(queryHash) === read) reads.delete(queryHash);
    void queryClient.resetQueries({ queryKey, exact: true });
  }
}

// Called once the claiming component is subscribed. A read spoiled after it
// was claimed is replaced by a fresh one.
export function releasePageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: PageOpenRead,
) {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  if (reads.get(queryHash) === read) reads.delete(queryHash);
  if (!read.invalidated) return;
  void queryClient.cancelQueries({ queryKey, exact: true });
  void queryClient.refetchQueries({ queryKey, exact: true });
}

export function adoptPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): PageOpenReadAdoption {
  const { adoption, read } = claimPageOpenRead(queryClient, queryKey);
  if (read) openReads(queryClient).delete(hashKey(queryKey));
  return adoption;
}

// This tab is changing the page, so no read already under way for it can be
// shown as the page's current state.
export function spoilPageOpenReads(
  queryClient: QueryClient,
  documentId: string,
) {
  for (const read of openReads(queryClient).values()) {
    if (read.documentId === documentId) read.invalidated = true;
  }
}

export function retirePageOpenReads(
  queryClient: QueryClient,
  keepDocumentId: string | null,
) {
  const reads = openReads(queryClient);
  for (const [queryHash, read] of reads) {
    if (read.documentId !== keepDocumentId) reads.delete(queryHash);
  }
}

// A load of /page/:id sends its page read from a script in the document head,
// beside the session read, instead of waiting for the app code to arrive. It
// is sent only where the module-time read would be: a top-level window with
// the session hint. The page's first read takes its answer once, for the same
// page and context; any other answer, or none, leaves the read to the app.
const STARTUP_PAGE_READ_GLOBAL = "__contentStartupPageRead";
export const STARTUP_PAGE_READ_TIMEOUT_MS = 15_000;
// How long the app waits on a head read still out before sending its own. The
// head read is usually in by the time the app code runs, so this only bounds
// a slow or stalled one; whichever read answers first is the page.
export const STARTUP_PAGE_READ_WAIT_MS = 1_000;

export type StartupPageReadAnswer =
  | { ok: true; value: unknown }
  | { ok: false };

type StartupPageRead = {
  id: string;
  databaseId: string | null;
  databaseDocumentId: string | null;
  // When the request left, so its age counts from the read, not from the
  // moment the app code takes it.
  startedAt: number;
  answer: Promise<StartupPageReadAnswer>;
};

export type TakenStartupPageRead = {
  startedAt: number;
  answer: Promise<StartupPageReadAnswer>;
};

declare global {
  interface Window {
    [STARTUP_PAGE_READ_GLOBAL]?: StartupPageRead;
  }
}

declare const __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__: string | undefined;

// The action routes refuse an in-app request from another build's code, by
// this version. The head script is part of the shell, so it sends the shell's
// own build, which is the build of the app code that shell loads.
function buildClientCompatibilityVersion(): string {
  if (typeof __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ === "string") {
    return __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__;
  }
  return (
    (
      globalThis as typeof globalThis & {
        __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__?: string;
      }
    ).__AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ ?? ""
  );
}

/**
 * `basePath` is the mount the server renders under, the prefix the router
 * strips: a load opens a page when its path, less that prefix, is exactly
 * `/page/:id`.
 */
export function startupPageReadScript(
  actionUrl: string,
  basePath = "",
  compatibilityVersion = buildClientCompatibilityVersion(),
): string {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Agent-Native-Frontend": "1",
  };
  if (compatibilityVersion) {
    headers["X-Agent-Native-Client-Compatibility"] = compatibilityVersion;
  }
  return `(function(){try{if(window.top!==window)return;var h=document.cookie.split(";").some(function(e){e=e.trim();var s=e.indexOf("=");if(s<1||e.slice(s+1)!=="1")return false;var n=e.slice(0,s);return n==="an_session_hint"||(n.indexOf("an_session_")===0&&n.slice(-5)==="_hint")});if(!h)return;var l=location.pathname,b=${JSON.stringify(basePath)};if(b&&l.indexOf(b+"/")===0)l=l.slice(b.length);var m=/^\\/page\\/([^/]+)\\/?$/.exec(l);if(!m)return;var q=new URLSearchParams(location.search),e=q.get("embedded");if(e==="1"||e==="true")return;var id=decodeURIComponent(m[1]),d=q.get("databaseId"),dd=q.get("databaseDocumentId"),p=new URLSearchParams();p.set("id",id);if(d)p.set("databaseId",d);if(dd)p.set("databaseDocumentId",dd);p.set("includePreviewDraft","true");var c=typeof AbortController==="function"?new AbortController():null,t=setTimeout(function(){if(c)c.abort()},${STARTUP_PAGE_READ_TIMEOUT_MS}),i={credentials:"same-origin",cache:"no-store",headers:${JSON.stringify(headers)}};if(c)i.signal=c.signal;var f=function(){return{ok:false}};window[${JSON.stringify(
    STARTUP_PAGE_READ_GLOBAL,
  )}]={id:id,databaseId:d,databaseDocumentId:dd,startedAt:Date.now(),answer:fetch(${JSON.stringify(
    actionUrl,
  )}+"?"+p.toString(),i).then(function(r){return r.ok?r.json().then(function(v){return{ok:true,value:v}},f):f()},f).then(function(a){clearTimeout(t);return a})}}catch(e){}})();`; // coercion-ok: a script that cannot send leaves the read to the app.
}

export function takeStartupPageRead(
  documentId: string,
  context: {
    databaseId?: string | null;
    databaseDocumentId?: string | null;
  },
): TakenStartupPageRead | null {
  if (typeof window === "undefined") return null;
  const read = window[STARTUP_PAGE_READ_GLOBAL];
  if (!read) return null;
  delete window[STARTUP_PAGE_READ_GLOBAL];
  if (
    read.id !== documentId ||
    read.databaseId !== (context.databaseId ?? null) ||
    read.databaseDocumentId !== (context.databaseDocumentId ?? null)
  ) {
    return null;
  }
  // The script read the page with the cookies the load's first session read
  // went out with. Once another session read has answered, the cookies may
  // name another account, so the answer is that account's page or nobody's.
  if (firstSessionReadAnswer() === "replaced") return null;
  if (!(Date.now() - read.startedAt < PAGE_OPEN_READ_TTL_MS)) return null;
  return {
    startedAt: read.startedAt,
    answer: read.answer.then((answer) =>
      firstSessionReadAnswer() === "replaced" ? { ok: false } : answer,
    ),
  };
}

// The page from the head script's read, or from the app's own read when the
// head read failed or is still out after a short wait. Once the app has sent
// its own read, the first of the two to answer is the page. It fails only once
// both have failed, with the app's own request's error.
export function readFromStartupPageRead<T>(
  startupRead: TakenStartupPageRead,
  sendOwnRead: () => Promise<T>,
  waitMs = STARTUP_PAGE_READ_WAIT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let ownRead: Promise<T> | null = null;
    let ownFailure: { error: unknown } | null = null;
    let headFailed = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(wait);
      finish();
    };
    const sendOwn = () => {
      if (ownRead || settled) return;
      ownRead = sendOwnRead();
      ownRead.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => {
          ownFailure = { error };
          if (headFailed) settle(() => reject(error));
        },
      );
    };
    const wait = setTimeout(sendOwn, waitMs);
    void startupRead.answer.then((answer) => {
      if (answer.ok) {
        settle(() => resolve(answer.value as T));
        return;
      }
      headFailed = true;
      const failure = ownFailure;
      if (failure) settle(() => reject(failure.error));
      else sendOwn();
    });
  });
}
