import {
  sessionReadIdentity,
  sessionReadIdentityStatus,
  subscribeSessionReadIdentity,
  type SessionReadIdentity,
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
  // Who the read was sent as. It is shown only while that is the session
  // this tab accepts (`sessionReadIdentityStatus` is "current").
  identity: SessionReadIdentity;
  // A read dropped as not this session's is read again, and a component
  // already holding it counts that read as its open's once a fetch's own
  // success lands it. The query observer cannot tell: dropping the read resets
  // the query's update count below where the observer started counting.
  readAgain: "no" | "pending" | "landed";
};

export type PageOpenReadAdoption = "fresh" | "pending" | "none";

const readsByClient = new WeakMap<QueryClient, Map<string, PageOpenRead>>();
// Dropped reads whose page is being read again, by query hash.
const droppedByClient = new WeakMap<QueryClient, Map<string, PageOpenRead>>();

// Every read is checked against the session this tab accepts, claimed or
// not, until it has been handed to its component under the session it was
// sent as. One whose session is replaced by another account's, or that went
// out over another transport, is dropped before the app shows it. Work that
// must not run as another account waits here too.
type WatchedReads = {
  reads: Map<PageOpenRead, { queryKey: QueryKey; handedOver: boolean }>;
  waiting: Array<{ identity: SessionReadIdentity; run: () => void }>;
  unsubscribe: () => void;
};
const watchedByClient = new WeakMap<QueryClient, WatchedReads>();

function watchReads(queryClient: QueryClient): WatchedReads {
  let watched = watchedByClient.get(queryClient);
  if (!watched) {
    const created: WatchedReads = {
      reads: new Map(),
      waiting: [],
      unsubscribe: subscribeSessionReadIdentity(() =>
        settleReadIdentities(queryClient),
      ),
    };
    watchedByClient.set(queryClient, created);
    watched = created;
  }
  return watched;
}

// Runs before the app behind the session gate is shown: the session store
// calls it in the task that changes the session, ahead of its own subscribers.
function settleReadIdentities(queryClient: QueryClient) {
  const watched = watchedByClient.get(queryClient);
  if (!watched) return;
  for (const [read, { queryKey, handedOver }] of watched.reads) {
    const status = sessionReadIdentityStatus(read.identity);
    if (status === "stale") {
      watched.reads.delete(read);
      dropRead(queryClient, queryKey, read);
    } else if (status === "current" && handedOver) {
      watched.reads.delete(read);
    }
  }
  const ready: Array<() => void> = [];
  watched.waiting = watched.waiting.filter(({ identity, run }) => {
    const status = sessionReadIdentityStatus(identity);
    if (status === "current") ready.push(run);
    return status === "pending";
  });
  if (watched.reads.size === 0 && watched.waiting.length === 0) {
    watched.unsubscribe();
    watchedByClient.delete(queryClient);
  }
  for (const run of ready) run();
}

// Not the session this tab accepts: none of it is shown, and a component
// already holding it reads it again.
function dropRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: PageOpenRead,
) {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  if (reads.get(queryHash) === read) reads.delete(queryHash);
  read.readAgain = "pending";
  let dropped = droppedByClient.get(queryClient);
  if (!dropped) {
    dropped = new Map();
    droppedByClient.set(queryClient, dropped);
  }
  dropped.set(queryHash, read);
  void queryClient.resetQueries({ queryKey, exact: true });
}

function handOver(queryClient: QueryClient, read: PageOpenRead) {
  const watched = watchedByClient.get(queryClient);
  const entry = watched?.reads.get(read);
  if (!entry) return;
  entry.handedOver = true;
  settleReadIdentities(queryClient);
}

// Runs `callback` once a request sent as `identity` is known to have been
// answered for the session this tab accepts, and never if it was not.
export function whenReadIdentityCurrent(
  queryClient: QueryClient,
  identity: SessionReadIdentity,
  callback: () => void,
) {
  const status = sessionReadIdentityStatus(identity);
  if (status === "current") callback();
  else if (status === "pending") {
    watchReads(queryClient).waiting.push({ identity, run: callback });
  }
}

// Whether nothing may be shown from this read yet: the session read that
// decides whom it was answered for is still out. A read found to be someone
// else's has already been dropped and is being read again.
export function isAwaitingSession(read: PageOpenRead | null) {
  return (
    read !== null && sessionReadIdentityStatus(read.identity) === "pending"
  );
}

function openReads(queryClient: QueryClient) {
  let reads = readsByClient.get(queryClient);
  if (!reads) {
    reads = new Map();
    readsByClient.set(queryClient, reads);
    queryClient.getQueryCache().subscribe((event) => {
      const dropped = droppedByClient.get(queryClient);
      if (event.type === "removed") {
        reads!.delete(event.query.queryHash);
        dropped?.delete(event.query.queryHash);
        const watched = watchedByClient.get(queryClient)?.reads;
        for (const [read, { queryKey }] of watched ?? []) {
          if (hashKey(queryKey) === event.query.queryHash)
            watched?.delete(read);
        }
        return;
      }
      if (event.type !== "updated") return;
      const droppedRead = dropped?.get(event.query.queryHash);
      if (
        droppedRead &&
        event.action.type === "success" &&
        event.action.manual !== true
      ) {
        droppedRead.readAgain = "landed";
        dropped?.delete(event.query.queryHash);
      }
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
    identity = sessionReadIdentity(),
    startedAt = Date.now(),
  }: { identity?: SessionReadIdentity; startedAt?: number } = {},
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
  const read: PageOpenRead = {
    documentId,
    startedAt,
    invalidated: false,
    landed: false,
    identity,
    readAgain: "no",
  };
  reads.set(queryHash, read);
  watchReads(queryClient).reads.set(read, {
    queryKey: options.queryKey,
    handedOver: false,
  });
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
  // A read still waiting on the session is adopted, and the session's answer
  // decides it before anything shows it. One sent as someone else is not.
  if (sessionReadIdentityStatus(read.identity) === "stale") {
    watchedByClient.get(queryClient)?.reads.delete(read);
    dropRead(queryClient, queryKey, read);
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
  handOver(queryClient, read);
  if (!read.invalidated) return;
  void queryClient.cancelQueries({ queryKey, exact: true });
  void queryClient.refetchQueries({ queryKey, exact: true });
}

export function adoptPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): PageOpenReadAdoption {
  const { adoption, read } = claimPageOpenRead(queryClient, queryKey);
  if (read) {
    openReads(queryClient).delete(hashKey(queryKey));
    handOver(queryClient, read);
  }
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
  // The fetch it went out on, beside the shell's session read.
  fetch: typeof fetch;
  answer: Promise<StartupPageReadAnswer>;
};

export type TakenStartupPageRead = {
  startedAt: number;
  identity: SessionReadIdentity;
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
  )}]={id:id,databaseId:d,databaseDocumentId:dd,startedAt:Date.now(),fetch:fetch,answer:fetch(${JSON.stringify(
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
  if (typeof read.fetch !== "function") return null;
  // The script read the page with the cookies the load's first session read
  // went out with, over the page's fetch as it was then. It is the page only
  // for that session, and only if the app would read it over the same
  // transport, since the app's own read can take its place.
  const identity = sessionReadIdentity({
    fetch: read.fetch,
    sentWithFirstSessionRead: true,
  });
  if (sessionReadIdentityStatus(identity) === "stale") return null;
  if (identity.transport !== sessionReadIdentity().transport) return null;
  if (!(Date.now() - read.startedAt < PAGE_OPEN_READ_TTL_MS)) return null;
  return {
    startedAt: read.startedAt,
    identity,
    answer: read.answer.then((answer) =>
      sessionReadIdentityStatus(identity) === "stale" ? { ok: false } : answer,
    ),
  };
}

// The page from the head script's read, or from the app's own read when the
// head read failed or is still out after a short wait. Once the app has sent
// its own read, the first of the two to answer is the page. It fails only once
// both have failed, with the app's own request's error.
export function readFromStartupPageRead<T>(
  startupRead: { answer: Promise<StartupPageReadAnswer> },
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
