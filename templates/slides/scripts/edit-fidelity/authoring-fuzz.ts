import type { OutsideSnapshot } from "./lib/in-page.ts";
import { outsideChangesFor } from "./lib/metrics.ts";
import { CouldNotRun, getHarnessUnavailableError } from "./run-outcomes.ts";

export const AUTHORING_FUZZ_STYLE_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "color",
  "-webkit-text-fill-color",
  "text-shadow",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-underline-offset",
  "font-feature-settings",
  "font-variation-settings",
  "text-align",
  "vertical-align",
  "white-space",
  "opacity",
  "visibility",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "background-color",
  "background-image",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "clip-path",
  "mask-image",
  "mix-blend-mode",
  "isolation",
  "z-index",
  "overflow-x",
  "overflow-y",
  "contain",
  "content-visibility",
  "object-fit",
  "object-position",
  "align-content",
  "align-items",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "gap",
  "row-gap",
  "column-gap",
  "grid-area",
  "grid-auto-flow",
  "grid-column-end",
  "grid-column-start",
  "grid-row-end",
  "grid-row-start",
  "grid-template-areas",
  "grid-template-columns",
  "grid-template-rows",
];

export function authoringFuzzBrowserSessionResponse(
  method: string,
  pathname: string,
  requestBody?: unknown,
): { ok: boolean; [key: string]: unknown } | null {
  const basePath = "/_agent-native/browser-sessions";
  const body =
    requestBody && typeof requestBody === "object"
      ? (requestBody as Record<string, unknown>)
      : {};
  const registration =
    method === "POST" &&
    (pathname === basePath ||
      /^\/_agent-native\/browser-sessions\/[^/]+\/heartbeat$/.test(pathname));
  if (registration) {
    const sessionIdFromPath = pathname.match(
      /^\/_agent-native\/browser-sessions\/([^/]+)\/heartbeat$/,
    )?.[1];
    const nestedSession =
      body.session && typeof body.session === "object"
        ? (body.session as Record<string, unknown>)
        : {};
    const sessionId =
      sessionIdFromPath ??
      (typeof body.sessionId === "string" ? body.sessionId : undefined) ??
      (typeof nestedSession.id === "string" ? nestedSession.id : undefined);
    if (!sessionId) {
      return {
        ok: false,
        error: "Browser-session registration omitted its id",
      };
    }

    const now = Date.now();
    const session = {
      sessionId,
      session: { ...nestedSession, id: sessionId },
      actions: Array.isArray(body.actions) ? body.actions : [],
      ...(Array.isArray(body.webmcpTools)
        ? { webmcpTools: body.webmcpTools }
        : {}),
      connectedAt: now,
      lastSeenAt: now,
      expiresAt: now + 60_000,
      active: true,
    };
    return { ok: true, session };
  }

  if (
    method === "POST" &&
    /^\/_agent-native\/browser-sessions\/[^/]+\/requests\/claim$/.test(pathname)
  ) {
    return { ok: true, request: null };
  }

  if (
    method === "DELETE" &&
    /^\/_agent-native\/browser-sessions\/[^/]+$/.test(pathname)
  ) {
    return { ok: true, deleted: true };
  }

  if (method === "GET" && pathname === basePath) {
    return { ok: true, sessions: [] };
  }

  return null;
}

export function authoringFuzzBrowserSessionCorsHeaders(
  origin?: string,
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Agent-Native-CSRF",
    ...(origin ? { Vary: "Origin" } : {}),
    ...(origin && origin !== "null"
      ? { "Access-Control-Allow-Credentials": "true" }
      : {}),
  };
}

export function recordCleanupRequestOutcome(
  finishedAt: WeakMap<object, number>,
  request: object,
  outcome: "finished" | "failed",
  at: number,
) {
  if (outcome === "finished") finishedAt.set(request, at);
  else finishedAt.delete(request);
}

type Page = any;
type Locator = any;
type ScrollBox = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  offsetHeight: number;
  rect: { x: number; y: number; width: number; height: number };
};
type SlideScrollState = {
  canvasRect: { x: number; y: number; width: number; height: number };
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  offsetHeight: number;
  rect: { x: number; y: number; width: number; height: number };
  scrollAncestors: Array<{
    tag: string;
    className: string;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    rect: { x: number; y: number; width: number; height: number };
  }>;
  documentScrollTop: number;
  editorAncestors: Array<ScrollBox & { key: string }>;
  fit: {
    x: number;
    y: number;
    width: number;
    height: number;
    transform: string;
    transformOrigin: string;
    top: string;
    left: string;
    right: string;
    bottom: string;
    position: string;
    marginTop: string;
    marginBottom: string;
    alignSelf: string;
    fitScale: string;
    fitX: string;
    fitY: string;
  } | null;
  fitLayers: Array<{
    className: string;
    autofitContent: boolean;
    autofitActive: boolean;
    rect: { x: number; y: number; width: number; height: number };
    transform: string;
    fitScale: string;
    fitX: string;
    fitY: string;
    parentClassName: string;
    parentY: number;
  }>;
};

export function lineNavigationKeys(platform: string) {
  return platform === "darwin"
    ? { start: "Meta+ArrowLeft", end: "Meta+ArrowRight" }
    : { start: "Home", end: "End" };
}

export function isBrowserSessionPath(pathname: string) {
  const basePath = "/_agent-native/browser-sessions";
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isBrowserSessionClaimRequest(method: string, pathname: string) {
  const matchesPath =
    typeof browserSessionClaimRequestRule.path === "string"
      ? browserSessionClaimRequestRule.path === pathname
      : browserSessionClaimRequestRule.path.test(pathname);
  return matchesPath && browserSessionClaimRequestRule.method === method;
}

function browserSessionClaimId(pathname: string) {
  return /^\/_agent-native\/browser-sessions\/([^/]+)\/requests\/claim$/.exec(
    pathname,
  )?.[1];
}

export function uniquePendingBrowserSessionId(
  claims: readonly { method: string; pathname: string }[],
) {
  const sessionIds = new Set(
    claims
      .filter((claim) =>
        isBrowserSessionClaimRequest(claim.method, claim.pathname),
      )
      .map((claim) => browserSessionClaimId(claim.pathname))
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  return sessionIds.size === 1
    ? (sessionIds.values().next().value ?? null)
    : null;
}

export function browserSessionIdAfterRequest(
  currentSessionId: string | null,
  method: string,
  pathname: string,
) {
  return isBrowserSessionClaimRequest(method, pathname)
    ? (browserSessionClaimId(pathname) ?? null)
    : currentSessionId;
}

export function isPostNavigationBrowserSessionTraffic(
  pathname: string,
  requestStartedDuringNavigation: boolean,
  requestStartedAfterNavigation: boolean,
) {
  return (
    isBrowserSessionPath(pathname) &&
    (requestStartedDuringNavigation || requestStartedAfterNavigation)
  );
}

export function isCompetingRetiredBrowserSessionTraffic(candidate: {
  pathname: string;
  requestStartedDuringNavigation: boolean;
  requestStartedAfterNavigation: boolean;
  requestSourceIsMainFrame: boolean;
  requestFrameUrl: string | null;
  outgoingDocumentUrl: string | null;
  requestSessionId: string | null;
  retiredSessionId: string | null;
}) {
  if (
    !isPostNavigationBrowserSessionTraffic(
      candidate.pathname,
      candidate.requestStartedDuringNavigation,
      candidate.requestStartedAfterNavigation,
    )
  ) {
    return false;
  }

  const isOutgoingRetiredSessionRequest =
    candidate.requestStartedDuringNavigation &&
    candidate.requestSourceIsMainFrame &&
    candidate.requestSessionId !== null &&
    candidate.requestSessionId === candidate.retiredSessionId &&
    normalizeDocumentUrl(candidate.requestFrameUrl) !== null &&
    normalizeDocumentUrl(candidate.requestFrameUrl) ===
      normalizeDocumentUrl(candidate.outgoingDocumentUrl);

  return !isOutgoingRetiredSessionRequest;
}

type SaveReloadRequestAbortRule = {
  path: string | RegExp;
  method?: string;
  errorTexts: readonly string[];
};

const navigationAbortErrors = ["NS_BINDING_ABORTED", "net::ERR_ABORTED"];
// Browser-session requests abort after at least ten seconds; leave timer slack.
const reloadNavigationAbortMaxRequestAgeMs = 9_000;
const reloadNavigationConsoleGraceMs = 1_000;
const retiredBrowserSessionPollConsoleGraceMs = 250;
const reloadNavigationSuccessfulClaimGraceMs = 250;
const outgoingBrowserSessionAbortWindowMs = 1_000;

const browserSessionRegistrationRequestRule: SaveReloadRequestAbortRule = {
  path: "/_agent-native/browser-sessions",
  method: "POST",
  errorTexts: ["Load request cancelled", "cancelled", ...navigationAbortErrors],
};

const browserSessionClaimRequestRule: SaveReloadRequestAbortRule = {
  path: /^\/_agent-native\/browser-sessions\/[^/]+\/requests\/claim$/,
  method: "POST",
  errorTexts: ["Load request cancelled", "cancelled", ...navigationAbortErrors],
};

const saveReloadRequestAbortRules: readonly SaveReloadRequestAbortRule[] = [
  {
    path: "/_agent-native/actions/get-lab-states",
    errorTexts: navigationAbortErrors,
  },
  {
    path: "/_agent-native/actions/get-deck-access-status",
    errorTexts: navigationAbortErrors,
  },
  browserSessionRegistrationRequestRule,
  browserSessionClaimRequestRule,
];

export function isExpectedSaveReloadWatchedRequestAbort(
  pathname: string,
  errorText: string,
  activePhase: string,
  method?: string,
  requestWasPendingAtReloadNavigation = false,
  requestAgeMs = Number.POSITIVE_INFINITY,
  requestStartedDuringNavigation = false,
  competingClaimStartedAfterNavigation = false,
  requestSameOrigin = false,
) {
  return (
    activePhase === "save/reload" &&
    requestSameOrigin &&
    requestWasPendingAtReloadNavigation &&
    !requestStartedDuringNavigation &&
    !competingClaimStartedAfterNavigation &&
    requestAgeMs >= 0 &&
    requestAgeMs < reloadNavigationAbortMaxRequestAgeMs &&
    saveReloadRequestAbortRules.some((rule) => {
      const matchesPath =
        typeof rule.path === "string"
          ? rule.path === pathname
          : rule.path.test(pathname);
      return (
        matchesPath &&
        (!rule.method || rule.method === method) &&
        rule.errorTexts.includes(errorText)
      );
    })
  );
}

function browserSessionNavigationRequestKind(method: string, pathname: string) {
  if (isBrowserSessionClaimRequest(method, pathname)) return "poll" as const;
  if (method === "POST" && pathname === "/_agent-native/browser-sessions") {
    return "heartbeat" as const;
  }
  return null;
}

type BrowserSessionNavigationRequestIdentity =
  | {
      status: "identified";
      kind: "poll" | "heartbeat";
      sessionId: string;
    }
  | { status: "invalid"; reason: "malformed-registration" };

export function browserSessionNavigationRequestIdentity(
  method: string,
  pathname: string,
  postData: string | null,
): BrowserSessionNavigationRequestIdentity | null {
  const kind = browserSessionNavigationRequestKind(method, pathname);
  if (!kind) return null;
  const claimSessionId = browserSessionClaimId(pathname);
  if (kind === "poll")
    return claimSessionId
      ? { status: "identified", kind, sessionId: claimSessionId }
      : null;
  if (postData === null) {
    return { status: "invalid", reason: "malformed-registration" };
  }

  let body: unknown;
  try {
    body = JSON.parse(postData);
  } catch {
    return { status: "invalid", reason: "malformed-registration" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "invalid", reason: "malformed-registration" };
  }
  const record = body as Record<string, unknown>;
  const sessionRecord = record.session;
  if (
    "sessionId" in record &&
    (typeof record.sessionId !== "string" || !record.sessionId)
  ) {
    return { status: "invalid", reason: "malformed-registration" };
  }
  if (
    sessionRecord !== undefined &&
    (!sessionRecord ||
      typeof sessionRecord !== "object" ||
      Array.isArray(sessionRecord))
  ) {
    return { status: "invalid", reason: "malformed-registration" };
  }
  const nestedSessionId =
    sessionRecord && typeof sessionRecord === "object"
      ? (sessionRecord as Record<string, unknown>).id
      : undefined;
  if (
    nestedSessionId !== undefined &&
    (typeof nestedSessionId !== "string" || !nestedSessionId)
  ) {
    return { status: "invalid", reason: "malformed-registration" };
  }
  const sessionIds = [record.sessionId, nestedSessionId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!sessionIds.length || new Set(sessionIds).size !== 1) {
    return { status: "invalid", reason: "malformed-registration" };
  }
  return { status: "identified", kind, sessionId: sessionIds[0] };
}

type OutgoingBrowserSessionNavigationAbort = {
  activePhase: string;
  method: string;
  pathname: string;
  errorText: string;
  sameOrigin: boolean;
  resourceType: string;
  requestSourceIsMainFrame: boolean;
  requestFrameUrl: string | null;
  outgoingDocumentUrl: string | null;
  requestStartedAt: number;
  mainFrameNavigationStartedAt: number | null;
  requestSequence: number;
  mainFrameNavigationRequestSequence: number | null;
  requestStartedBeforeMainFrameCommit: boolean;
  requestFailedAt: number;
  requestKind: "poll" | "heartbeat" | null;
  requestSessionId: string | null;
  retiredSessionId: string | null;
  competingSameTypeRequest: boolean;
};

type DeferredOutgoingBrowserSessionAbort = {
  failureAt: number | null;
  failureText: string | null;
  outgoingNavigationAbort: boolean;
  pendingOutgoingAbort: boolean;
};

export function finalizeDeferredOutgoingBrowserSessionAbort(
  candidate: DeferredOutgoingBrowserSessionAbort,
  isExpected: (failureAt: number, failureText: string) => boolean,
) {
  if (
    !candidate.pendingOutgoingAbort ||
    candidate.failureAt === null ||
    candidate.failureText === null
  ) {
    return "not-pending" as const;
  }

  candidate.pendingOutgoingAbort = false;
  candidate.outgoingNavigationAbort = isExpected(
    candidate.failureAt,
    candidate.failureText,
  );
  return candidate.outgoingNavigationAbort
    ? ("expected" as const)
    : ("unexpected" as const);
}

function normalizeDocumentUrl(value: string | null) {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function isCompetingOutgoingBrowserSessionRequest(
  requestKind: "poll" | "heartbeat" | null,
  outgoingDocumentUrl: string | null,
  candidate: {
    outgoingRequestKind: "poll" | "heartbeat" | null;
    requestSourceIsMainFrame: boolean;
    requestFrameUrl: string | null;
    finishedSuccessfully: boolean;
    mainFrameNavigationRequestSequence: number | null;
    mainFrameNavigationStartedAt: number | null;
    requestSequence: number;
    requestStartedBeforeMainFrameCommit: boolean;
  },
) {
  const belongsToReloadedDocument =
    candidate.mainFrameNavigationStartedAt !== null &&
    candidate.mainFrameNavigationRequestSequence !== null &&
    candidate.requestSequence > candidate.mainFrameNavigationRequestSequence &&
    !candidate.requestStartedBeforeMainFrameCommit;

  return (
    requestKind !== null &&
    candidate.outgoingRequestKind === requestKind &&
    candidate.requestSourceIsMainFrame &&
    !candidate.finishedSuccessfully &&
    !belongsToReloadedDocument &&
    normalizeDocumentUrl(candidate.requestFrameUrl) !== null &&
    normalizeDocumentUrl(candidate.requestFrameUrl) ===
      normalizeDocumentUrl(outgoingDocumentUrl)
  );
}

export function isExpectedOutgoingBrowserSessionNavigationAbort(
  candidate: OutgoingBrowserSessionNavigationAbort,
) {
  const routeMatchesKind =
    (candidate.requestKind === "poll" &&
      browserSessionClaimId(candidate.pathname) ===
        candidate.requestSessionId) ||
    (candidate.requestKind === "heartbeat" &&
      candidate.pathname === "/_agent-native/browser-sessions");
  const navigationOffsetMs =
    candidate.mainFrameNavigationStartedAt === null
      ? Number.POSITIVE_INFINITY
      : candidate.requestStartedAt - candidate.mainFrameNavigationStartedAt;
  const failureOffsetMs =
    candidate.requestFailedAt - candidate.requestStartedAt;

  return (
    candidate.activePhase === "save/reload" &&
    candidate.method === "POST" &&
    (candidate.errorText === "NS_BINDING_ABORTED" ||
      candidate.errorText === "net::ERR_ABORTED") &&
    candidate.sameOrigin &&
    candidate.resourceType === "fetch" &&
    candidate.requestSourceIsMainFrame &&
    normalizeDocumentUrl(candidate.requestFrameUrl) !== null &&
    normalizeDocumentUrl(candidate.requestFrameUrl) ===
      normalizeDocumentUrl(candidate.outgoingDocumentUrl) &&
    navigationOffsetMs >= 0 &&
    navigationOffsetMs < outgoingBrowserSessionAbortWindowMs &&
    candidate.mainFrameNavigationRequestSequence !== null &&
    candidate.requestSequence > candidate.mainFrameNavigationRequestSequence &&
    candidate.requestStartedBeforeMainFrameCommit &&
    failureOffsetMs >= 0 &&
    failureOffsetMs < outgoingBrowserSessionAbortWindowMs &&
    candidate.requestSessionId !== null &&
    candidate.requestSessionId === candidate.retiredSessionId &&
    routeMatchesKind &&
    candidate.competingSameTypeRequest === false
  );
}

type WatchedRequestNavigationCandidate = {
  url: string;
  pathname: string;
  method: string;
  ageMs: number;
  settledAgeMs?: number;
  responseStatus?: number;
  sameOrigin?: boolean;
  requestWasPendingAtNavigation?: boolean;
  requestFinishedSuccessfully?: boolean;
  completedSuccessfullyBeforeNavigation?: boolean;
  completedBeforeNavigationAgeMs?: number;
  requestStartedDuringNavigation?: boolean;
  requestStartedAfterNavigation?: boolean;
  requestStartedBeforeReloadCommit?: boolean;
  competingRequestStartedAfterNavigation?: boolean;
  competingClaimStartedAfterNavigation?: boolean;
  competingRegistrationStartedAfterNavigation?: boolean;
  outgoingNavigationAbort?: boolean;
  outgoingRequestKind?: "poll" | "heartbeat";
  requestSessionId?: string | null;
  retiredSessionId?: string | null;
  outgoingAbortWarningAgeMs?: number;
  competingSameTypeRequest?: boolean;
};

function isExpectedWatchedRequestNavigationAbort(
  candidate: WatchedRequestNavigationCandidate,
  rules: readonly SaveReloadRequestAbortRule[],
  allowFinishedRequestGrace = false,
  rejectCompetingClaim = false,
) {
  return (
    candidate.requestWasPendingAtNavigation === true &&
    candidate.requestStartedDuringNavigation !== true &&
    candidate.requestStartedAfterNavigation !== true &&
    candidate.competingRequestStartedAfterNavigation !== true &&
    candidate.sameOrigin === true &&
    (!rejectCompetingClaim ||
      candidate.competingClaimStartedAfterNavigation !== true) &&
    (candidate.requestFinishedSuccessfully !== true ||
      (allowFinishedRequestGrace &&
        candidate.sameOrigin === true &&
        candidate.responseStatus !== undefined &&
        candidate.responseStatus >= 200 &&
        candidate.responseStatus < 300 &&
        candidate.settledAgeMs !== undefined &&
        candidate.settledAgeMs >= 0 &&
        candidate.settledAgeMs < reloadNavigationConsoleGraceMs)) &&
    candidate.ageMs >= 0 &&
    candidate.ageMs < reloadNavigationAbortMaxRequestAgeMs &&
    (candidate.settledAgeMs === undefined ||
      (candidate.settledAgeMs >= 0 &&
        candidate.settledAgeMs < reloadNavigationConsoleGraceMs)) &&
    rules.some((rule) => {
      const matchesPath =
        typeof rule.path === "string"
          ? rule.path === candidate.pathname
          : rule.path.test(candidate.pathname);
      return matchesPath && (!rule.method || rule.method === candidate.method);
    })
  );
}

export function isExpectedWatchedRequestCorsError(
  message: string,
  activePhase: string,
  candidates: WatchedRequestNavigationCandidate[],
) {
  const rules =
    activePhase === "save/reload"
      ? saveReloadRequestAbortRules
      : activePhase === "cleanup/navigation"
        ? [browserSessionClaimRequestRule]
        : null;
  if (!rules) return false;
  const match =
    /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.(?:\s+at\b[\s\S]*)?$/.exec(
      message,
    );
  if (!match) return false;

  return (
    candidates.filter(
      (candidate) =>
        candidate.url === match[1] &&
        isExpectedWatchedRequestNavigationAbort(
          candidate,
          rules,
          activePhase === "save/reload",
          activePhase === "save/reload",
        ),
    ).length === 1
  );
}

function hasExactlyOneExpectedBrowserSessionAbort(
  candidates: WatchedRequestNavigationCandidate[],
  rules: readonly SaveReloadRequestAbortRule[],
  allowFinishedRequestGrace = false,
  rejectCompetingClaim = false,
) {
  return (
    candidates.filter((candidate) =>
      isExpectedWatchedRequestNavigationAbort(
        candidate,
        rules,
        allowFinishedRequestGrace,
        rejectCompetingClaim,
      ),
    ).length === 1
  );
}

function isExpectedCompletedClaimBeforeReload(
  candidate: WatchedRequestNavigationCandidate,
) {
  const matchesPath =
    typeof browserSessionClaimRequestRule.path === "string"
      ? browserSessionClaimRequestRule.path === candidate.pathname
      : browserSessionClaimRequestRule.path.test(candidate.pathname);
  return (
    candidate.completedSuccessfullyBeforeNavigation === true &&
    candidate.requestWasPendingAtNavigation === false &&
    candidate.requestStartedDuringNavigation !== true &&
    candidate.requestStartedAfterNavigation !== true &&
    candidate.competingClaimStartedAfterNavigation !== true &&
    candidate.method === browserSessionClaimRequestRule.method &&
    matchesPath &&
    candidate.sameOrigin === true &&
    candidate.ageMs >= 0 &&
    candidate.ageMs < reloadNavigationAbortMaxRequestAgeMs &&
    candidate.responseStatus !== undefined &&
    candidate.responseStatus >= 200 &&
    candidate.responseStatus < 300 &&
    candidate.completedBeforeNavigationAgeMs !== undefined &&
    candidate.completedBeforeNavigationAgeMs >= 0 &&
    candidate.completedBeforeNavigationAgeMs <
      reloadNavigationSuccessfulClaimGraceMs &&
    candidate.settledAgeMs !== undefined &&
    candidate.settledAgeMs >= 0 &&
    candidate.settledAgeMs < reloadNavigationConsoleGraceMs
  );
}

function outgoingBrowserSessionWarningKind(message: string) {
  return message ===
    "[Agent-Native browser session] poll failed: TypeError: NetworkError when attempting to fetch resource."
    ? "poll"
    : message ===
        "[Agent-Native browser session] heartbeat failed: TypeError: NetworkError when attempting to fetch resource."
      ? "heartbeat"
      : null;
}

// Firefox can report a claim or registration the retired page sent as finished
// (its response arrived) while that page's fetch still rejects with
// NetworkError as the document is torn down. Playwright emits no requestfailed
// for it, so it never becomes an outgoing abort and the warning would otherwise
// be counted as an unexpected console error. A tab can keep its session id
// across the reload, so the id alone does not say which document sent the
// request: it was either in flight when the reload began or started before the
// reloaded document committed.
function isFinishedRetiredSessionRequest(
  candidate: WatchedRequestNavigationCandidate,
  requestKind: "poll" | "heartbeat",
  evaluationDelayMs: number,
) {
  return (
    candidate.requestFinishedSuccessfully === true &&
    (candidate.requestWasPendingAtNavigation === true ||
      (candidate.requestStartedDuringNavigation === true &&
        candidate.requestStartedBeforeReloadCommit === true)) &&
    candidate.outgoingRequestKind === requestKind &&
    candidate.sameOrigin === true &&
    candidate.requestSessionId !== null &&
    candidate.requestSessionId === candidate.retiredSessionId &&
    candidate.responseStatus !== undefined &&
    candidate.responseStatus >= 200 &&
    candidate.responseStatus < 300 &&
    candidate.settledAgeMs !== undefined &&
    // Ages are read when the candidates are evaluated, evaluationDelayMs after
    // the warning (the grace wait), so both bounds shift by it: the request must
    // have settled by the warning and within a second before it. One that
    // settled after the warning cannot be what tore the warned fetch down.
    candidate.settledAgeMs >= evaluationDelayMs &&
    candidate.settledAgeMs <
      reloadNavigationConsoleGraceMs + evaluationDelayMs &&
    candidate.competingSameTypeRequest !== true
  );
}

export function isExpectedSaveReloadBrowserSessionConsoleError(
  message: string,
  activePhase: string,
  candidates: WatchedRequestNavigationCandidate[],
  // How long after the warning the candidates were read.
  evaluationDelayMs = 0,
) {
  const outgoingRequestKind = outgoingBrowserSessionWarningKind(message);
  if (outgoingRequestKind) {
    if (activePhase !== "save/reload") return false;
    // A failed request is attributed to its warning one-to-one, so two are
    // ambiguous. A finished one carries no such attribution, and the retired
    // page keeps polling until the reloaded document commits, so any of them
    // excuses the warning.
    const aborted = candidates.filter(
      (candidate) =>
        candidate.outgoingNavigationAbort === true &&
        candidate.outgoingRequestKind === outgoingRequestKind &&
        candidate.requestSessionId !== null &&
        candidate.requestSessionId === candidate.retiredSessionId &&
        candidate.outgoingAbortWarningAgeMs !== undefined &&
        candidate.outgoingAbortWarningAgeMs >= 0 &&
        candidate.outgoingAbortWarningAgeMs <=
          retiredBrowserSessionPollConsoleGraceMs &&
        candidate.competingSameTypeRequest !== true,
    ).length;
    return aborted > 0
      ? aborted === 1
      : candidates.some((candidate) =>
          isFinishedRetiredSessionRequest(
            candidate,
            outgoingRequestKind,
            evaluationDelayMs,
          ),
        );
  }
  const rules =
    message ===
    "[Agent-Native browser session] poll failed: TypeError: Load failed"
      ? [browserSessionClaimRequestRule]
      : message ===
          "[Agent-Native browser session] heartbeat failed: TypeError: Load failed"
        ? [browserSessionRegistrationRequestRule]
        : null;
  const isPollFailure =
    message ===
    "[Agent-Native browser session] poll failed: TypeError: Load failed";
  const completedClaimCount = candidates.filter(
    isExpectedCompletedClaimBeforeReload,
  ).length;
  const claimCandidateCount = candidates.filter((candidate) =>
    isBrowserSessionClaimRequest(candidate.method, candidate.pathname),
  ).length;
  return (
    activePhase === "save/reload" &&
    rules !== null &&
    (hasExactlyOneExpectedBrowserSessionAbort(
      candidates,
      rules,
      isPollFailure,
      isPollFailure,
    ) ||
      (isPollFailure && completedClaimCount === 1 && claimCandidateCount === 1))
  );
}

export async function isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace(
  message: string,
  activePhase: string,
  getCandidates: () => WatchedRequestNavigationCandidate[],
  // When the warning was emitted; Firefox normalizes it asynchronously before
  // this runs, so the caller's own timestamp is the accurate baseline.
  warnedAt = Date.now(),
) {
  if (outgoingBrowserSessionWarningKind(message)) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, retiredBrowserSessionPollConsoleGraceMs),
    );
  }
  // Taken just before the candidates are read, so their ages and this delay
  // share one instant.
  const evaluationDelayMs = Math.max(0, Date.now() - warnedAt);
  return isExpectedSaveReloadBrowserSessionConsoleError(
    message,
    activePhase,
    getCandidates(),
    evaluationDelayMs,
  );
}

function matchesRetiredBrowserSessionCorsClaimError(
  message: string,
  activePhase: string,
  sessionIdAtNavigation: string | null,
  authoringPageOrigin: string,
  navigationStartedAt: number | null,
  now: number,
  competingClaimStartedAfterNavigation: boolean,
) {
  if (
    activePhase !== "save/reload" ||
    !sessionIdAtNavigation ||
    navigationStartedAt === null ||
    competingClaimStartedAfterNavigation ||
    now < navigationStartedAt
  ) {
    return false;
  }

  const match =
    /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.$/.exec(
      message,
    );
  if (!match || !URL.canParse(match[1])) return false;
  const url = new URL(match[1]);
  return (
    url.origin === authoringPageOrigin &&
    browserSessionClaimId(url.pathname) === sessionIdAtNavigation
  );
}

export function isExpectedSaveReloadRetiredBrowserSessionCorsError(
  message: string,
  activePhase: string,
  sessionIdAtNavigation: string | null,
  authoringPageOrigin: string,
  navigationStartedAt: number | null,
  now: number,
  competingClaimStartedAfterNavigation: boolean,
) {
  return (
    navigationStartedAt !== null &&
    now - navigationStartedAt < reloadNavigationConsoleGraceMs &&
    matchesRetiredBrowserSessionCorsClaimError(
      message,
      activePhase,
      sessionIdAtNavigation,
      authoringPageOrigin,
      navigationStartedAt,
      now,
      competingClaimStartedAfterNavigation,
    )
  );
}

export function isExpectedSaveReloadRetiredBrowserSessionPollWarning(
  message: string,
  activePhase: string,
  correlatedPageErrorAt: number | null,
  now: number,
) {
  return (
    message ===
      "[Agent-Native browser session] poll failed: TypeError: Load failed" &&
    activePhase === "save/reload" &&
    correlatedPageErrorAt !== null &&
    now >= correlatedPageErrorAt &&
    now - correlatedPageErrorAt <= retiredBrowserSessionPollConsoleGraceMs
  );
}

type RetiredBrowserSessionErrorEventResult = {
  matched: boolean;
  errors: string[];
};

type RetiredBrowserSessionErrorCandidate = {
  message: string;
  at: number;
  sessionId: string;
};

export function createRetiredBrowserSessionErrorCorrelator() {
  let sessionIdAtNavigation: string | null = null;
  let authoringPageOrigin: string | null = null;
  let navigationStartedAt: number | null = null;
  const pendingPageErrors: RetiredBrowserSessionErrorCandidate[] = [];
  const pendingPollWarnings: RetiredBrowserSessionErrorCandidate[] = [];

  const takeExpired = (now: number) => {
    const errors: string[] = [];
    for (const candidates of [pendingPageErrors, pendingPollWarnings]) {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if (now - candidate.at <= retiredBrowserSessionPollConsoleGraceMs) {
          continue;
        }
        errors.unshift(candidate.message);
        candidates.splice(index, 1);
      }
    }
    return errors;
  };

  return {
    beginNavigation(
      sessionId: string | null,
      origin: string,
      startedAt: number,
    ) {
      sessionIdAtNavigation = sessionId;
      authoringPageOrigin = origin;
      navigationStartedAt = startedAt;
    },
    finishNavigation(now: number) {
      if (navigationStartedAt === null) return 0;
      return Math.max(
        0,
        navigationStartedAt + reloadNavigationConsoleGraceMs - now,
      );
    },
    onPageError(
      message: string,
      activePhase: string,
      now: number,
      competingClaimStartedAfterNavigation: boolean,
    ): RetiredBrowserSessionErrorEventResult {
      const errors = takeExpired(now);
      if (
        !authoringPageOrigin ||
        !matchesRetiredBrowserSessionCorsClaimError(
          message,
          activePhase,
          sessionIdAtNavigation,
          authoringPageOrigin,
          navigationStartedAt,
          now,
          competingClaimStartedAfterNavigation,
        ) ||
        !sessionIdAtNavigation
      ) {
        return { matched: false, errors };
      }

      const pollWarningIndex = pendingPollWarnings.findIndex(
        (candidate) =>
          candidate.sessionId === sessionIdAtNavigation &&
          isExpectedSaveReloadRetiredBrowserSessionPollWarning(
            "[Agent-Native browser session] poll failed: TypeError: Load failed",
            activePhase,
            candidate.at,
            now,
          ),
      );
      if (pollWarningIndex >= 0) {
        pendingPollWarnings.splice(pollWarningIndex, 1);
        return { matched: true, errors };
      }

      if (
        !isExpectedSaveReloadRetiredBrowserSessionCorsError(
          message,
          activePhase,
          sessionIdAtNavigation,
          authoringPageOrigin,
          navigationStartedAt,
          now,
          competingClaimStartedAfterNavigation,
        )
      ) {
        return { matched: false, errors };
      }

      pendingPageErrors.push({
        message,
        at: now,
        sessionId: sessionIdAtNavigation,
      });
      return { matched: true, errors };
    },
    onPollWarning(
      message: string,
      activePhase: string,
      now: number,
      currentSessionId: string | null,
      competingClaimStartedAfterNavigation: boolean,
    ): RetiredBrowserSessionErrorEventResult {
      const errors = takeExpired(now);
      if (
        message !==
          "[Agent-Native browser session] poll failed: TypeError: Load failed" ||
        activePhase !== "save/reload" ||
        navigationStartedAt === null ||
        now < navigationStartedAt ||
        !sessionIdAtNavigation ||
        currentSessionId !== sessionIdAtNavigation ||
        competingClaimStartedAfterNavigation
      ) {
        return { matched: false, errors };
      }

      const pageErrorIndex = pendingPageErrors.findIndex(
        (candidate) =>
          candidate.sessionId === sessionIdAtNavigation &&
          isExpectedSaveReloadRetiredBrowserSessionPollWarning(
            message,
            activePhase,
            candidate.at,
            now,
          ),
      );
      if (pageErrorIndex >= 0) {
        pendingPageErrors.splice(pageErrorIndex, 1);
        return { matched: true, errors };
      }

      if (now - navigationStartedAt >= reloadNavigationConsoleGraceMs) {
        return { matched: false, errors };
      }

      pendingPollWarnings.push({
        message,
        at: now,
        sessionId: sessionIdAtNavigation,
      });
      return { matched: true, errors };
    },
    nextExpiryDelay(now: number) {
      const nextExpiryAt = Math.min(
        ...[...pendingPageErrors, ...pendingPollWarnings].map(
          (candidate) =>
            candidate.at + retiredBrowserSessionPollConsoleGraceMs + 1,
        ),
      );
      return Number.isFinite(nextExpiryAt)
        ? Math.max(1, nextExpiryAt - now)
        : null;
    },
    flushExpired(now: number) {
      return takeExpired(now);
    },
    clear() {
      const errors = [
        ...pendingPageErrors.map(({ message }) => message),
        ...pendingPollWarnings.map(({ message }) => message),
      ];
      pendingPageErrors.length = 0;
      pendingPollWarnings.length = 0;
      sessionIdAtNavigation = null;
      authoringPageOrigin = null;
      navigationStartedAt = null;
      return errors;
    },
  };
}

export function isFirefoxBrowserSessionConsoleError(message: string) {
  return /^\[Agent-Native browser session\] (?:poll|heartbeat) failed: JSHandle@object$/.test(
    message,
  );
}

type BrowserSessionConsoleArgument = {
  jsonValue(): Promise<unknown>;
  evaluate<T>(pageFunction: (value: unknown) => T): Promise<T>;
};

type BrowserSessionConsoleMessage = {
  text(): string;
  args(): BrowserSessionConsoleArgument[];
};

export async function normalizeFirefoxBrowserSessionConsoleError(
  message: BrowserSessionConsoleMessage,
) {
  const text = message.text();
  const match =
    /^\[Agent-Native browser session\] (poll|heartbeat) failed: JSHandle@object$/.exec(
      text,
    );
  if (!match) return text;

  try {
    const args = message.args();
    if (args.length !== 2) return text;
    const prefix = `[Agent-Native browser session] ${match[1]} failed:`;
    const [loggedPrefix, detail] = await Promise.all([
      args[0].jsonValue(),
      args[1].evaluate((error) => String(error)),
    ]);
    if (loggedPrefix !== prefix) return text;
    return typeof detail === "string" ? `${prefix} ${detail}` : text;
  } catch {
    return text;
  }
}

export function isExpectedCleanupBrowserSessionPollConsoleError(
  message: string,
  candidates: WatchedRequestNavigationCandidate[],
) {
  return (
    message ===
      "[Agent-Native browser session] poll failed: TypeError: Load failed" &&
    !candidates.some(
      (candidate) => candidate.competingClaimStartedAfterNavigation === true,
    ) &&
    hasExactlyOneExpectedBrowserSessionAbort(candidates, [
      browserSessionClaimRequestRule,
    ])
  );
}

export function isExpectedCleanupRecoveryPageBrowserSessionError(
  message: string,
  candidates: Array<{
    url: string;
    pathname: string;
    method: string;
    requestAgeMs: number;
    failureAgeMs: number;
    sameOrigin: boolean;
    competingClaimStartedAfterFailure: boolean;
  }>,
) {
  const corsUrl =
    /^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.(?:\s+at\b[\s\S]*)?$/.exec(
      message,
    )?.[1] ?? null;
  const knownFailure =
    message ===
      "[Agent-Native browser session] poll failed: TypeError: Load failed" ||
    corsUrl !== null;
  if (!knownFailure) return false;
  const taggedPoll =
    message ===
    "[Agent-Native browser session] poll failed: TypeError: Load failed";

  return (
    candidates.filter(
      (candidate) =>
        candidate.method === "POST" &&
        /^\/_agent-native\/browser-sessions\/[^/]+\/requests\/claim$/.test(
          candidate.pathname,
        ) &&
        (candidate.sameOrigin ||
          taggedPoll ||
          (corsUrl !== null && candidate.url === corsUrl)) &&
        !candidate.competingClaimStartedAfterFailure &&
        candidate.requestAgeMs >= 0 &&
        candidate.requestAgeMs < reloadNavigationAbortMaxRequestAgeMs &&
        candidate.failureAgeMs >= 0 &&
        candidate.failureAgeMs <= retiredBrowserSessionPollConsoleGraceMs &&
        (corsUrl === null || candidate.url === corsUrl),
    ).length === 1
  );
}

export function isExpectedCleanupBrowserSessionHeartbeatConsoleError(
  message: string,
  candidates: WatchedRequestNavigationCandidate[],
) {
  return (
    message ===
      "[Agent-Native browser session] heartbeat failed: TypeError: Load failed" &&
    !candidates.some(
      (candidate) =>
        candidate.competingRegistrationStartedAfterNavigation === true,
    ) &&
    hasExactlyOneExpectedBrowserSessionAbort(candidates, [
      browserSessionRegistrationRequestRule,
    ])
  );
}

export function isExpectedCleanupNavigationError(
  message: string,
  candidates: WatchedRequestNavigationCandidate[],
  navigationStarted: boolean,
) {
  return (
    navigationStarted &&
    (isExpectedWatchedRequestCorsError(
      message,
      "cleanup/navigation",
      candidates,
    ) ||
      isExpectedCleanupBrowserSessionPollConsoleError(message, candidates) ||
      isExpectedCleanupBrowserSessionHeartbeatConsoleError(message, candidates))
  );
}

export function isExpectedSaveReloadWatchedRequestCorsConsoleError(
  message: string,
  activePhase: string,
  candidates: Array<{
    url: string;
    pathname: string;
    method: string;
    ageMs: number;
    settledAgeMs?: number;
    responseStatus?: number;
    sameOrigin?: boolean;
    requestWasPendingAtReloadNavigation?: boolean;
    requestStartedDuringNavigation?: boolean;
    requestStartedAfterNavigation?: boolean;
    requestFinishedSuccessfully?: boolean;
    competingRequestStartedAfterNavigation?: boolean;
    competingClaimStartedAfterNavigation?: boolean;
  }>,
) {
  if (activePhase !== "save/reload") return false;
  return isExpectedWatchedRequestCorsError(
    message,
    activePhase,
    candidates.map((candidate) => ({
      ...candidate,
      requestWasPendingAtNavigation:
        candidate.requestWasPendingAtReloadNavigation,
    })),
  );
}

export function isConflictResourceConsoleError(message: string) {
  return /\bstatus of 409\b/.test(message);
}

export function authoringFuzzLineNavigationKeys(
  platform: string,
  override?: ReturnType<typeof lineNavigationKeys>,
) {
  return override ?? lineNavigationKeys(platform);
}

export function authoringFuzzProfileIndex(seed: number): number | null {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("seed must be a non-negative safe integer");
  if (seed === 0 || seed % 2 === 1) return null;
  return (seed / 2 - 1) % 6;
}

export function findAuthoringFuzzScratchDeckId(
  decks: Array<{ id?: string; title?: string }>,
  title: string,
): string | null {
  return (
    decks.find(
      (deck) => deck.title === title && typeof deck.id === "string" && deck.id,
    )?.id ?? null
  );
}

export function resolveAuthoringFuzzScratchDeck(
  result: { decks?: Array<{ id?: string; title?: string }> },
  title: string,
) {
  if (!Array.isArray(result.decks)) return { status: "missing-decks" as const };
  const deckId = findAuthoringFuzzScratchDeckId(result.decks, title);
  return deckId
    ? { status: "found" as const, deckId }
    : { status: "not-found" as const };
}

export async function retryAuthoringFuzzScratchDeckLookup(
  lookup: () => Promise<{ decks?: Array<{ id?: string; title?: string }> }>,
  title: string,
  options: {
    windowMs?: number;
    intervalMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
) {
  const windowMs = Math.max(1, options.windowMs ?? 60_000);
  const intervalMs = Math.max(1, options.intervalMs ?? 5_000);
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + windowMs;
  let lastRecovery: ReturnType<typeof resolveAuthoringFuzzScratchDeck> | null =
    null;
  let lastError: unknown;
  let lastAttemptFailed = false;

  while (now() < deadline) {
    try {
      lastRecovery = resolveAuthoringFuzzScratchDeck(await lookup(), title);
      lastError = undefined;
      lastAttemptFailed = false;
      if (lastRecovery.status === "found") return lastRecovery;
    } catch (error) {
      lastError = error;
      lastAttemptFailed = true;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await wait(Math.min(intervalMs, remainingMs));
  }

  if (lastAttemptFailed) throw lastError;
  if (lastRecovery) return lastRecovery;
  throw new Error("scratch-deck lookup window expired before a lookup");
}

export function formatAuthoringFuzzCleanupIssue(
  label: string,
  deckId: string | null,
  error: unknown,
) {
  return `${label} [deckId=${deckId || "unknown"}]: ${String(error)}`;
}

export function outsideAuthoringChangesFor(
  before: OutsideSnapshot,
  after: OutsideSnapshot,
) {
  return outsideChangesFor(before, after).changes;
}

export function isCaretScrollOnlyChange(
  changes: Array<{ key: string; prop?: string; a?: string; b?: string }>,
  options: {
    scrollDelta: number;
    contentGrew: boolean;
    containerOverflows: boolean;
    containerStationary: boolean;
    fitPositionStylesUnchanged: boolean;
    fitSizeUnchanged: boolean;
  },
) {
  const [change] = changes;
  return (
    changes.length === 1 &&
    !!change &&
    change.key.startsWith("box:div.") &&
    change.key.includes(".fmd-autofit-scale#") &&
    change.prop === "y" &&
    Number.isFinite(Number(change.a)) &&
    Number.isFinite(Number(change.b)) &&
    Math.abs(options.scrollDelta) > 1 &&
    options.contentGrew &&
    options.containerOverflows &&
    options.containerStationary &&
    options.fitPositionStylesUnchanged &&
    options.fitSizeUnchanged &&
    Math.abs(Number(change.b) - Number(change.a) + options.scrollDelta) <= 1
  );
}

export function assertShortcutMarkupAdded(
  result: string,
  before: number,
  after: number,
) {
  if (after <= before) {
    throw new Error(
      `markdown shortcut did not produce ${result} (${before} -> ${after})`,
    );
  }
}

export type AuthoringFuzzOperation =
  | { kind: "type"; value: string }
  | { kind: "shortcut"; value: string; result: string }
  | { kind: "slash"; value: string; result: string }
  | { kind: "list"; value: "styled" | "ul" | "ol" }
  | {
      kind: "tab" | "shift-tab";
      list: "styled" | "ul" | "ol";
    }
  | {
      kind:
        | "enter-block-edge"
        | "backspace-block-edge"
        | "delete-block-edge"
        | "enter-list-edge"
        | "backspace-list-edge"
        | "delete-list-edge"
        | "paste-plain"
        | "paste-rich"
        | "slash-tab"
        | "slash-escape"
        | "slash-filter"
        | "slash-away"
        | "slash-delete"
        | "slash-position"
        | "slash-outside"
        | "shortcut-undo"
        | "slash-undo"
        | "heading-backspace"
        | "quote-backspace"
        | "heading-enter"
        | "quote-exit"
        | "empty-list-exit"
        | "soft-break"
        | "paste-markdown"
        | "paste-url"
        | "link-shortcut"
        | "vertical-navigation"
        | "select-cross-block-type"
        | "select-cross-block-delete"
        | "bold"
        | "italic"
        | "underline"
        | "strike-shortcut"
        | "code-shortcut"
        | "copy-inline"
        | "replacement"
        | "undo"
        | "redo";
    };

export interface AuthoringFuzzPersistence {
  /** Exact inner HTML of the full slide before editing. */
  originalHtml: string;
  /** Exact inner HTML of the full live slide after editing ends. */
  liveHtml: string;
  /** Exact inner HTML of the full slide returned by persistence. */
  savedHtml: string;
  /** Exact inner HTML of the full slide after a fresh reload. */
  reloadedHtml: string;
}

export function authoringFuzzListTagForOperation(
  operation: AuthoringFuzzOperation,
): "OL" | "UL" | null {
  if (operation.kind === "list") {
    return operation.value === "ul"
      ? "UL"
      : operation.value === "ol"
        ? "OL"
        : null;
  }
  if (operation.kind === "slash") {
    return operation.value === "bulletList"
      ? "UL"
      : operation.value === "orderedList"
        ? "OL"
        : null;
  }
  return operation.kind === "shortcut" && operation.result === "ordered"
    ? "OL"
    : null;
}

export function authoringFuzzPrecedingListMergePreservesIdentity(
  candidateId: string,
  resultId: string | null,
) {
  return resultId === candidateId;
}

export async function canonicalizeAuthoringFuzzPersistence(
  persistence: AuthoringFuzzPersistence,
  canonicalize: (html: string) => string | Promise<string>,
): Promise<AuthoringFuzzPersistence> {
  return {
    originalHtml: await canonicalize(persistence.originalHtml),
    liveHtml: await canonicalize(persistence.liveHtml),
    savedHtml: await canonicalize(persistence.savedHtml),
    reloadedHtml: await canonicalize(persistence.reloadedHtml),
  };
}

export interface AuthoringFuzzOptions {
  seed: number;
  steps: number;
  /** Selector for the active in-place contenteditable element. */
  editorSelector: string;
  /** Selector for the containing slide canvas. */
  slideSelector: string;
  /** Selector for the slide markup that must round-trip through undo/redo. */
  slideContentSelector: string;
  /** Target and slide markup captured before entering edit mode. */
  originalHtml: string;
  originalSlideHtml: string;
  /** Watched browser requests already pending when the page was created. */
  initialPendingWatchedRequests?: ReadonlyMap<any, number>;
  /** Exit editing, wait for the save, read the stored HTML, then reload/read it. */
  finishAndReload: (
    markReloadNavigationStart: () => void,
  ) => Promise<AuthoringFuzzPersistence>;
  modifier: "Meta" | "Control";
  /** The in-place editor's undo snapshot cap. */
  historyLimit?: number;
  /** Fail if the caller's viewport did not scale the selected slide down. */
  expectScaledSlide?: boolean;
  browser?: "chromium" | "webkit" | "firefox";
  lineKeys?: ReturnType<typeof lineNavigationKeys>;
}

export interface AuthoringFuzzResult {
  seed: number;
  stepsRun: number;
  stepLog: AuthoringFuzzOperation[];
  undoSteps: number;
  redoSteps: number;
}

export function assertByteIdenticalHtml(
  actual: string,
  expected: string,
  label: string,
) {
  if (actual !== expected) {
    let offset = 0;
    while (
      offset < actual.length &&
      offset < expected.length &&
      actual[offset] === expected[offset]
    ) {
      offset += 1;
    }
    throw new Error(
      `${label} did not restore byte-identical HTML (first difference at code unit ${offset}; actual length ${actual.length}, expected length ${expected.length})`,
    );
  }
}

export function requireUndoHistoryStats(
  stats: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!stats || typeof stats.initialStateEvicted !== "boolean") {
    throw new Error(
      "authoring fuzz could not inspect undo history before undo-all",
    );
  }
  if (stats.initialStateEvicted) {
    throw new Error("undo history evicted the original state before undo-all");
  }
  return stats;
}

export function assertAuthoringPersistence(
  persistence: AuthoringFuzzPersistence,
) {
  if (persistence.savedHtml === persistence.originalHtml) {
    throw new Error("authoring flow did not change the persisted slide HTML");
  }
  // Rendering adds safe link defaults that are intentionally absent in storage.
  if (persistence.reloadedHtml !== persistence.liveHtml) {
    throw new Error(
      "reloaded slide HTML differed from the post-edit live slide",
    );
  }
}

const SHORTCUTS = [
  ["- ", "bullet"],
  ["* ", "bullet"],
  ["+ ", "bullet"],
  ["1. ", "ordered"],
  ["# ", "heading1"],
  ["## ", "heading2"],
  ["### ", "heading3"],
  ["#### ", "heading4"],
  ["> ", "quote"],
  ["--- ", "divider"],
  ["___ ", "divider"],
  ["*** ", "divider"],
  ["**bold**", "bold"],
  ["__bold__", "bold"],
  ["*italic*", "italic"],
  ["_italic_", "italic"],
  ["~~strike~~", "strike"],
  ["`code`", "code"],
] as const;

const SLASH_COMMANDS = [
  ["paragraph", "paragraph"],
  ["heading1", "heading 1"],
  ["heading2", "heading 2"],
  ["heading3", "heading 3"],
  ["bulletList", "bullet list"],
  ["orderedList", "numbered list"],
  ["quote", "quote"],
  ["divider", "divider"],
] as const;

export function authoringFuzzSlashArrowDownCount(
  activeCommand: string | null,
  targetCommand: string,
) {
  const activeIndex = SLASH_COMMANDS.findIndex(
    ([value]) => value === activeCommand,
  );
  const targetIndex = SLASH_COMMANDS.findIndex(
    ([value]) => value === targetCommand,
  );
  if (activeIndex < 0)
    throw new Error("slash menu did not expose its active command");
  if (targetIndex < 0)
    throw new Error(`unknown slash command ${targetCommand}`);
  return (
    (targetIndex - activeIndex + SLASH_COMMANDS.length) % SLASH_COMMANDS.length
  );
}

const RANDOM_KINDS: AuthoringFuzzOperation["kind"][] = [
  "type",
  "shortcut",
  "slash",
  "list",
  "enter-block-edge",
  "backspace-block-edge",
  "delete-block-edge",
  "enter-list-edge",
  "backspace-list-edge",
  "delete-list-edge",
  "tab",
  "shift-tab",
  "paste-plain",
  "paste-rich",
  "slash-tab",
  "slash-escape",
  "slash-filter",
  "slash-away",
  "slash-delete",
  "slash-position",
  "slash-outside",
  "shortcut-undo",
  "slash-undo",
  "heading-backspace",
  "quote-backspace",
  "heading-enter",
  "quote-exit",
  "empty-list-exit",
  "soft-break",
  "paste-markdown",
  "paste-url",
  "link-shortcut",
  "select-cross-block-type",
  "select-cross-block-delete",
  "bold",
  "italic",
  "underline",
  "strike-shortcut",
  "code-shortcut",
  "copy-inline",
  "replacement",
  "undo",
  "redo",
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOperation(
  random: () => number,
  index: number,
): AuthoringFuzzOperation {
  const kind = RANDOM_KINDS[Math.floor(random() * RANDOM_KINDS.length)];
  if (kind === "type") {
    return { kind, value: `f${index.toString(36)}q` };
  }
  if (kind === "list") {
    return {
      kind,
      value: (["styled", "ul", "ol"] as const)[Math.floor(random() * 3)],
    };
  }
  if (kind === "shortcut") {
    const [value, result] = SHORTCUTS[Math.floor(random() * SHORTCUTS.length)];
    return { kind, value, result };
  }
  if (kind === "slash") {
    const [value, result] =
      SLASH_COMMANDS[Math.floor(random() * SLASH_COMMANDS.length)];
    return { kind, value, result };
  }
  if (kind === "tab" || kind === "shift-tab") {
    return {
      kind,
      list: (["styled", "ul", "ol"] as const)[Math.floor(random() * 3)],
    };
  }
  return { kind } as AuthoringFuzzOperation;
}

/** Returns a reproducible prefix that covers every shortcut and slash command. */
export function createAuthoringFuzzPlan(
  seed: number,
  steps: number,
): AuthoringFuzzOperation[] {
  if (!Number.isSafeInteger(seed))
    throw new Error("seed must be a safe integer");
  if (!Number.isInteger(steps) || steps < 1)
    throw new Error("steps must be a positive integer");

  const plan: AuthoringFuzzOperation[] = [
    ...(authoringFuzzProfileIndex(seed) === 0
      ? [{ kind: "vertical-navigation" as const }]
      : []),
    ...SHORTCUTS.map(([value, result]) => ({
      kind: "shortcut" as const,
      value,
      result,
    })),
    ...SLASH_COMMANDS.map(([value, result]) => ({
      kind: "slash" as const,
      value,
      result,
    })),
    { kind: "type", value: "fastburst" },
    { kind: "list", value: "styled" },
    { kind: "list", value: "ul" },
    { kind: "list", value: "ol" },
    { kind: "enter-block-edge" },
    { kind: "backspace-block-edge" },
    { kind: "delete-block-edge" },
    { kind: "enter-list-edge" },
    { kind: "backspace-list-edge" },
    { kind: "delete-list-edge" },
    { kind: "tab", list: "styled" },
    { kind: "shift-tab", list: "styled" },
    { kind: "tab", list: "ul" },
    { kind: "shift-tab", list: "ul" },
    { kind: "tab", list: "ol" },
    { kind: "shift-tab", list: "ol" },
    { kind: "paste-plain" },
    { kind: "paste-rich" },
    { kind: "slash-tab" },
    { kind: "slash-escape" },
    { kind: "slash-filter" },
    { kind: "slash-away" },
    { kind: "slash-delete" },
    { kind: "slash-position" },
    { kind: "slash-outside" },
    { kind: "shortcut-undo" },
    { kind: "slash-undo" },
    { kind: "heading-backspace" },
    { kind: "quote-backspace" },
    { kind: "heading-enter" },
    { kind: "quote-exit" },
    { kind: "empty-list-exit" },
    { kind: "soft-break" },
    { kind: "paste-markdown" },
    { kind: "paste-url" },
    { kind: "link-shortcut" },
    { kind: "select-cross-block-type" },
    { kind: "select-cross-block-delete" },
    { kind: "bold" },
    { kind: "italic" },
    { kind: "underline" },
    { kind: "strike-shortcut" },
    { kind: "code-shortcut" },
    { kind: "copy-inline" },
    { kind: "replacement" },
    { kind: "undo" },
    { kind: "redo" },
  ];

  const random = seededRandom(seed);
  while (plan.length < steps) plan.push(randomOperation(random, plan.length));
  const selected = plan.slice(0, steps);
  if (
    ["undo", "redo", "shortcut-undo", "slash-undo"].includes(
      selected.at(-1)?.kind ?? "",
    )
  ) {
    selected[selected.length - 1] = { kind: "type", value: `finish${seed}` };
  }
  return selected;
}

const MAX_FAILURE_LOG_OPERATIONS = 20;
const MAX_FAILURE_MESSAGE_LENGTH = 3500;
const MAX_PRIOR_REGRESSION_SUMMARIES = 5;
const MAX_PRIOR_REGRESSION_SUMMARY_LENGTH = 300;

export function formatAuthoringFuzzUnavailable(
  message: string,
  problems: readonly string[],
  cleanupIssues: readonly string[] = [],
) {
  const summarize = (items: readonly string[], overflowLabel: string) => {
    const summaries = items
      .slice(0, MAX_PRIOR_REGRESSION_SUMMARIES)
      .map(
        (item) =>
          `- ${item.replaceAll(/\s+/g, " ").slice(0, MAX_PRIOR_REGRESSION_SUMMARY_LENGTH)}`,
      );
    if (items.length > summaries.length) {
      summaries.push(
        `- ${items.length - summaries.length} more ${overflowLabel}`,
      );
    }
    return summaries;
  };

  const lines = [message];
  if (problems.length) {
    lines.push(
      `Earlier authoring regression(s) before the harness became unavailable (${problems.length}):`,
      ...summarize(problems, "regression(s)"),
    );
  }
  if (cleanupIssues.length) {
    lines.push(
      `Authoring fuzz cleanup issue(s) (${cleanupIssues.length}):`,
      ...summarize(cleanupIssues, "cleanup issue(s)"),
    );
  }
  return lines.join("\n");
}

export function authoringFuzzUnavailableExitCode(
  priorRegressionCount: number,
): 1 | 2 {
  return priorRegressionCount > 0 ? 1 : 2;
}

export function formatAuthoringFuzzFailure(
  seed: number,
  phase: string,
  log: AuthoringFuzzOperation[],
  message: string,
  browser: "chromium" | "webkit" | "firefox" = "chromium",
) {
  const replaySteps = Math.max(1, log.length);
  const logStart = Math.max(0, log.length - MAX_FAILURE_LOG_OPERATIONS);
  const excerpt = log.slice(logStart).map((operation, index) => ({
    step: logStart + index,
    operation,
  }));
  const boundedMessage =
    message.length > MAX_FAILURE_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`
      : message;
  return new Error(
    `authoring fuzz failed (seed=${seed}, phase=${phase}): ${boundedMessage}\n` +
      `Replay: pnpm exec tsx scripts/edit-fidelity/run.ts --authoring-fuzz --seed ${seed} --steps ${replaySteps} --browser ${browser}\n` +
      `Failure log: steps ${logStart}-${log.length - 1} of ${log.length} replay steps\n` +
      JSON.stringify(excerpt, null, 2),
  );
}

export async function assertSlideIsScaled(page: Page, selector: string) {
  const scale = await page
    .locator(selector)
    .evaluate((element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    });
  if (!(scale > 0 && scale < 0.99)) {
    throw new Error(
      `scaled fixture did not scale below 0.99 (scale ${scale.toFixed(3)})`,
    );
  }
}

export async function runAuthoringFuzz(
  page: Page,
  options: AuthoringFuzzOptions,
): Promise<AuthoringFuzzResult> {
  const { seed, steps, editorSelector, slideSelector, slideContentSelector } =
    options;
  const plan = createAuthoringFuzzPlan(seed, steps);
  const { modifier } = options;
  const { start: lineStartKey, end: lineEndKey } =
    authoringFuzzLineNavigationKeys(process.platform, options.lineKeys);
  const historyLimit = options.historyLimit ?? 100;
  const traceEnabled = process.env.SLIDES_AUTHORING_FUZZ_TRACE === "1";
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error("historyLimit must be a positive safe integer");
  }
  const editor: Locator = page.locator(editorSelector);
  const slideContent: Locator = page.locator(slideContentSelector);
  const authoringPageOrigin = new URL(page.url()).origin;
  const retiredSessionErrorCorrelator =
    createRetiredBrowserSessionErrorCorrelator();
  const pageErrors: string[] = [];
  const pendingRequests = new Map<
    any,
    { method: string; path: string; startedAt: number }
  >();
  const watchedRequests = new Map(options.initialPendingWatchedRequests);
  const inFlightBrowserSessionClaims = new Map<
    any,
    { startedAt: number; responseStatus: number | null }
  >();
  const recentlyCompletedBrowserSessionClaims = new Map<
    any,
    { startedAt: number; settledAt: number; responseStatus: number }
  >();
  type ReloadNavigationRequest = {
    startedAt: number;
    settledAt: number | null;
    finishedSuccessfully: boolean;
    responseStatus: number | null;
    requestWasPendingAtNavigation: boolean;
    completedSuccessfullyBeforeNavigation: boolean;
    completedBeforeNavigationAgeMs: number | null;
    requestStartedDuringNavigation: boolean;
    requestStartedAfterNavigation: boolean;
    requestSequence: number;
    resourceType: string;
    requestSourceIsMainFrame: boolean;
    requestFrameUrl: string | null;
    outgoingDocumentUrl: string | null;
    outgoingRequestKind: "poll" | "heartbeat" | null;
    requestSessionId: string | null;
    mainFrameNavigationStartedAt: number | null;
    mainFrameNavigationRequestSequence: number | null;
    requestStartedBeforeMainFrameCommit: boolean;
    requestStartedBeforeReloadCommit: boolean;
    retiredSessionId: string | null;
    failureAt: number | null;
    failureText: string | null;
    pendingOutgoingAbort: boolean;
    outgoingNavigationAbort: boolean;
  };
  const reloadNavigationRequests = new Map<any, ReloadNavigationRequest>();
  const pendingOutgoingAbortTimers = new Set<ReturnType<typeof setTimeout>>();
  let reloadNavigationStartedAt: number | null = null;
  // Keep the latest start after openSlide returns to correlate late poll errors.
  let lastReloadStartedAt: number | null = null;
  let outgoingDocumentUrlAtReload: string | null = null;
  let mainFrameNavigationStartedAt: number | null = null;
  let mainFrameNavigationRequestSequence: number | null = null;
  let mainFrameNavigationCommittedAt: number | null = null;
  let requestEventSequence = 0;
  let currentBrowserSessionId: string | null = null;
  let browserSessionIdAtReload: string | null = null;
  const hasCompetingClaimStartedAfterNavigation = (request: any) => {
    const url = new URL(request.url());
    if (!isBrowserSessionClaimRequest(request.method(), url.pathname))
      return false;
    return [...reloadNavigationRequests.entries()].some(
      ([otherRequest, otherCandidate]) => {
        if (
          otherRequest === request ||
          (!otherCandidate.requestStartedDuringNavigation &&
            !otherCandidate.requestStartedAfterNavigation)
        ) {
          return false;
        }
        const otherUrl = new URL(otherRequest.url());
        return (
          otherRequest.method() === request.method() &&
          otherUrl.pathname === url.pathname
        );
      },
    );
  };
  const hasCompetingNewBrowserSessionTraffic = () =>
    [...reloadNavigationRequests.entries()].some(([request, candidate]) =>
      isCompetingRetiredBrowserSessionTraffic({
        pathname: new URL(request.url()).pathname,
        requestStartedDuringNavigation:
          candidate.requestStartedDuringNavigation,
        requestStartedAfterNavigation: candidate.requestStartedAfterNavigation,
        requestSourceIsMainFrame: candidate.requestSourceIsMainFrame,
        requestFrameUrl: candidate.requestFrameUrl,
        outgoingDocumentUrl: candidate.outgoingDocumentUrl,
        requestSessionId: candidate.requestSessionId,
        retiredSessionId: candidate.retiredSessionId,
      }),
    );
  const hasCompetingOutgoingSessionRequest = (request: any) => {
    const requestUrl = new URL(request.url());
    const requestKind = browserSessionNavigationRequestKind(
      request.method(),
      requestUrl.pathname,
    );
    return (
      requestKind !== null &&
      [...reloadNavigationRequests.entries()].some(
        ([otherRequest, otherCandidate]) =>
          otherRequest !== request &&
          isCompetingOutgoingBrowserSessionRequest(
            requestKind,
            outgoingDocumentUrlAtReload,
            otherCandidate,
          ),
      )
    );
  };
  const outgoingAbortFacts = (
    request: any,
    candidate: ReloadNavigationRequest,
    requestFailedAt: number,
    errorText: string,
  ): OutgoingBrowserSessionNavigationAbort => ({
    activePhase,
    method: request.method(),
    pathname: new URL(request.url()).pathname,
    errorText,
    sameOrigin: new URL(request.url()).origin === authoringPageOrigin,
    resourceType: candidate.resourceType,
    requestSourceIsMainFrame: candidate.requestSourceIsMainFrame,
    requestFrameUrl: candidate.requestFrameUrl,
    outgoingDocumentUrl: candidate.outgoingDocumentUrl,
    requestStartedAt: candidate.startedAt,
    mainFrameNavigationStartedAt: candidate.mainFrameNavigationStartedAt,
    requestSequence: candidate.requestSequence,
    mainFrameNavigationRequestSequence:
      candidate.mainFrameNavigationRequestSequence,
    requestStartedBeforeMainFrameCommit:
      candidate.requestStartedBeforeMainFrameCommit,
    requestFailedAt,
    requestKind: candidate.outgoingRequestKind,
    requestSessionId: candidate.requestSessionId,
    retiredSessionId: candidate.retiredSessionId,
    competingSameTypeRequest: hasCompetingOutgoingSessionRequest(request),
  });
  const finalizePendingOutgoingAborts = () => {
    const errors: string[] = [];
    for (const [request, candidate] of reloadNavigationRequests.entries()) {
      const outcome = finalizeDeferredOutgoingBrowserSessionAbort(
        candidate,
        (failureAt, failureText) =>
          isExpectedOutgoingBrowserSessionNavigationAbort(
            outgoingAbortFacts(request, candidate, failureAt, failureText),
          ),
      );
      if (outcome !== "unexpected") continue;
      reloadNavigationRequests.delete(request);
      const error = `watched request failed: ${request.method()} ${request.url()} (${candidate.failureText})`;
      pageErrors.push(error);
      errors.push(error);
    }
    return errors;
  };
  const scheduleOutgoingAbortFinalization = () => {
    const timer = setTimeout(() => {
      pendingOutgoingAbortTimers.delete(timer);
      finalizePendingOutgoingAborts();
    }, outgoingBrowserSessionAbortWindowMs + 1);
    pendingOutgoingAbortTimers.add(timer);
  };
  const clearOutgoingAbortTimers = () => {
    for (const timer of pendingOutgoingAbortTimers) clearTimeout(timer);
    pendingOutgoingAbortTimers.clear();
  };
  const onFrameNavigated = (frame: any) => {
    if (
      frame !== page.mainFrame() ||
      activePhase !== "save/reload" ||
      reloadNavigationStartedAt === null
    ) {
      return;
    }
    mainFrameNavigationCommittedAt = Date.now();
    finalizePendingOutgoingAborts();
    clearOutgoingAbortTimers();
  };
  const reloadNavigationCandidatesAt = (now: number) =>
    [...reloadNavigationRequests.entries()].map(([request, candidate]) => {
      const url = request.url();
      return {
        url,
        pathname: new URL(url).pathname,
        method: request.method(),
        ageMs: now - candidate.startedAt,
        sameOrigin: new URL(url).origin === authoringPageOrigin,
        ...(candidate.settledAt === null
          ? {}
          : { settledAgeMs: now - candidate.settledAt }),
        ...(candidate.responseStatus === null
          ? {}
          : { responseStatus: candidate.responseStatus }),
        requestFinishedSuccessfully: candidate.finishedSuccessfully,
        requestWasPendingAtNavigation: candidate.requestWasPendingAtNavigation,
        completedSuccessfullyBeforeNavigation:
          candidate.completedSuccessfullyBeforeNavigation,
        ...(candidate.completedBeforeNavigationAgeMs === null
          ? {}
          : {
              completedBeforeNavigationAgeMs:
                candidate.completedBeforeNavigationAgeMs,
            }),
        requestStartedDuringNavigation:
          candidate.requestStartedDuringNavigation,
        requestStartedAfterNavigation: candidate.requestStartedAfterNavigation,
        requestStartedBeforeReloadCommit:
          candidate.requestStartedBeforeReloadCommit,
        competingClaimStartedAfterNavigation:
          hasCompetingClaimStartedAfterNavigation(request),
        outgoingNavigationAbort: candidate.outgoingNavigationAbort,
        outgoingRequestKind: candidate.outgoingRequestKind ?? undefined,
        requestSessionId: candidate.requestSessionId,
        retiredSessionId: candidate.retiredSessionId,
        ...(candidate.failureAt === null
          ? {}
          : { outgoingAbortWarningAgeMs: now - candidate.failureAt }),
        competingSameTypeRequest: hasCompetingOutgoingSessionRequest(request),
      };
    });
  const pendingSaveConflicts: Promise<void>[] = [];
  const pendingConsoleInspections = new Set<Promise<void>>();
  const conflictResponsePaths: string[] = [];
  const patchDeckActionPath = "/_agent-native/actions/patch-deck";
  let patchDeckConflicts = 0;
  let conflictResourceErrors = 0;
  let activeIndex = -1;
  let activePhase = "setup";
  let slashHoverThemesChecked = false;
  currentBrowserSessionId = uniquePendingBrowserSessionId(
    [...watchedRequests.keys()].map((request) => ({
      method: request.method(),
      pathname: new URL(request.url()).pathname,
    })),
  );
  for (const [request, startedAt] of watchedRequests.entries()) {
    if (
      !isBrowserSessionClaimRequest(
        request.method(),
        new URL(request.url()).pathname,
      )
    ) {
      continue;
    }
    const claim = { startedAt, responseStatus: null };
    inFlightBrowserSessionClaims.set(request, claim);
    void request
      .response()
      .then((response: any) => {
        if (response) claim.responseStatus = response.status();
      })
      .catch(() => undefined);
  }
  const onConsole = (message: any) => {
    if (
      traceEnabled &&
      message.type() === "debug" &&
      message.text().startsWith("[authoring-fuzz heartbeat]")
    ) {
      console.log(message.text());
      return;
    }
    if (message.type() !== "error") return;
    if (traceEnabled) {
      console.log(
        `[edit-fidelity] console error phase=${activePhase} location=${JSON.stringify(message.location())}: ${message.text()}`,
      );
    }
    if (isConflictResourceConsoleError(message.text())) {
      conflictResourceErrors += 1;
      return;
    }
    const consoleText = message.text();
    const consolePhase = activePhase;
    const now = Date.now();
    const consoleSessionId = currentBrowserSessionId;
    const competingSessionTraffic = hasCompetingNewBrowserSessionTraffic();
    // Captured now, not when the log runs: Firefox normalization finishes
    // asynchronously, after reload state may have been reset. Offsets use the
    // latest reload start, which is never reset (negative = started before it).
    const startOffsetMs = (startedAt: number) =>
      lastReloadStartedAt === null ? null : startedAt - lastReloadStartedAt;
    const consoleTiming = {
      sinceReloadMs:
        lastReloadStartedAt === null ? null : Date.now() - lastReloadStartedAt,
      // Includes every input of isFinishedRetiredSessionRequest so a failure
      // that still slips through shows which condition rejected it.
      reloadMap: [...reloadNavigationRequests.entries()].map(
        ([request, candidate]) => ({
          pathname: new URL(request.url()).pathname,
          ageMs: now - candidate.startedAt,
          settledAgeMs:
            candidate.settledAt === null ? null : now - candidate.settledAt,
          startOffsetMs: startOffsetMs(candidate.startedAt),
          kind: candidate.outgoingRequestKind,
          finished: candidate.finishedSuccessfully,
          status: candidate.responseStatus,
          pendingAtReload: candidate.requestWasPendingAtNavigation,
          duringReload: candidate.requestStartedDuringNavigation,
          beforeCommit: candidate.requestStartedBeforeReloadCommit,
          retiredSession:
            candidate.requestSessionId !== null &&
            candidate.requestSessionId === candidate.retiredSessionId,
          competing: hasCompetingOutgoingSessionRequest(request),
        }),
      ),
      watched: [...watchedRequests.entries()].map(([request, startedAt]) => ({
        pathname: new URL(request.url()).pathname,
        method: request.method(),
        ageMs: Date.now() - startedAt,
        startOffsetMs: startOffsetMs(startedAt),
      })),
    };
    const recordUnlessExpected = async (text: string) => {
      const retiredSessionPollResult =
        retiredSessionErrorCorrelator.onPollWarning(
          text,
          consolePhase,
          now,
          consoleSessionId,
          competingSessionTraffic,
        );
      pageErrors.push(...retiredSessionPollResult.errors);
      if (retiredSessionPollResult.matched) {
        return;
      }
      if (
        (await isExpectedSaveReloadBrowserSessionConsoleErrorAfterGrace(
          text,
          consolePhase,
          () => reloadNavigationCandidatesAt(Date.now()),
          now,
        )) ||
        isExpectedWatchedRequestCorsError(
          text,
          consolePhase,
          reloadNavigationCandidatesAt(Date.now()),
        )
      ) {
        return;
      }
      // Diagnostic only: CI runs without tracing. consoleTiming was captured when
      // the console event arrived, so deferred Firefox messages report the same state.
      console.log(
        `[edit-fidelity] unexpected console error phase=${consolePhase} sinceReloadMs=${consoleTiming.sinceReloadMs ?? "n/a"} text=${JSON.stringify(text.slice(0, 240))} reloadMap=${JSON.stringify(consoleTiming.reloadMap)} watched=${JSON.stringify(consoleTiming.watched)}`,
      );
      pageErrors.push(text);
    };
    let inspection: Promise<void>;
    inspection = (async () => {
      const normalizedText = isFirefoxBrowserSessionConsoleError(consoleText)
        ? await normalizeFirefoxBrowserSessionConsoleError(message)
        : consoleText;
      await recordUnlessExpected(normalizedText);
    })().finally(() => pendingConsoleInspections.delete(inspection));
    pendingConsoleInspections.add(inspection);
  };
  const onPageError = (error: Error) => {
    const now = Date.now();
    // WebKit keeps the failed fetch URL on the stack's first line, not Error.message.
    const pageErrorText = (error.stack ?? error.message).split("\n", 1)[0];
    const retiredSessionPageErrorResult =
      retiredSessionErrorCorrelator.onPageError(
        pageErrorText,
        activePhase,
        now,
        hasCompetingNewBrowserSessionTraffic(),
      );
    pageErrors.push(...retiredSessionPageErrorResult.errors);
    if (retiredSessionPageErrorResult.matched) {
      if (traceEnabled) {
        console.log(
          `[edit-fidelity] correlated WebKit page error from the retired browser-session claim during reload (${browserSessionIdAtReload})`,
        );
      }
      return;
    }
    if (traceEnabled) {
      console.log(
        `[edit-fidelity] page error phase=${activePhase}: ${error.stack ?? error.message}`,
      );
    }
    pageErrors.push(error.stack ?? error.message);
  };
  const onRequestFailed = (request: any) => {
    const requestStartedAt = watchedRequests.get(request);
    const navigationCandidate = reloadNavigationRequests.get(request);
    const requestPendingAtReloadNavigation =
      navigationCandidate?.requestWasPendingAtNavigation === true;
    const competingClaimStartedAfterNavigation =
      hasCompetingClaimStartedAfterNavigation(request);
    pendingRequests.delete(request);
    watchedRequests.delete(request);
    inFlightBrowserSessionClaims.delete(request);
    const url = request.url();
    const requestUrl = new URL(url);
    const pathname = requestUrl.pathname;
    const errorText = request.failure()?.errorText ?? "unknown";
    if (traceEnabled || isBrowserSessionPath(pathname)) {
      console.log(
        `[edit-fidelity] request failed ${request.method()} ${pathname} (${errorText}) phase=${activePhase} ageMs=${requestStartedAt === undefined ? "unknown" : Date.now() - requestStartedAt} startOffsetMsFromLastReload=${requestStartedAt === undefined || lastReloadStartedAt === null ? "n/a" : requestStartedAt - lastReloadStartedAt}`,
      );
    }
    if (
      navigationCandidate &&
      navigationCandidate.outgoingRequestKind !== null &&
      navigationCandidate.outgoingRequestKind !== undefined &&
      !navigationCandidate.pendingOutgoingAbort &&
      !navigationCandidate.outgoingNavigationAbort
    ) {
      const failedAt = Date.now();
      const facts = outgoingAbortFacts(
        request,
        navigationCandidate,
        failedAt,
        errorText,
      );
      if (isExpectedOutgoingBrowserSessionNavigationAbort(facts)) {
        navigationCandidate.failureAt = failedAt;
        navigationCandidate.failureText = errorText;
        navigationCandidate.pendingOutgoingAbort = true;
        if (mainFrameNavigationCommittedAt !== null) {
          finalizePendingOutgoingAborts();
        } else {
          scheduleOutgoingAbortFinalization();
        }
        return;
      }
    }
    if (
      isExpectedSaveReloadWatchedRequestAbort(
        pathname,
        errorText,
        activePhase,
        request.method(),
        requestPendingAtReloadNavigation,
        requestStartedAt === undefined
          ? Number.POSITIVE_INFINITY
          : Date.now() - requestStartedAt,
        navigationCandidate?.requestStartedDuringNavigation === true,
        competingClaimStartedAfterNavigation,
        requestUrl.origin === authoringPageOrigin,
      )
    ) {
      const candidate = navigationCandidate;
      if (candidate) {
        candidate.settledAt = Date.now();
        candidate.finishedSuccessfully = false;
      }
      return;
    }
    reloadNavigationRequests.delete(request);
    if (
      [
        "/_agent-native/actions/get-lab-states",
        "/_agent-native/actions/get-deck-access-status",
      ].includes(pathname) ||
      isBrowserSessionPath(pathname)
    ) {
      pageErrors.push(
        `watched request failed: ${request.method()} ${url} (${errorText})`,
      );
    }
  };
  const onRequest = (request: any) => {
    const requestUrl = new URL(request.url());
    const startedAt = Date.now();
    const requestSequence = ++requestEventSequence;
    const requestFrame =
      request.serviceWorker() === null ? request.frame() : null;
    const requestSourceIsMainFrame = requestFrame === page.mainFrame();
    const isMainFrameNavigationRequest =
      requestSourceIsMainFrame && request.isNavigationRequest();
    if (
      isMainFrameNavigationRequest &&
      activePhase === "save/reload" &&
      reloadNavigationStartedAt !== null
    ) {
      mainFrameNavigationStartedAt = startedAt;
      mainFrameNavigationRequestSequence = requestSequence;
      mainFrameNavigationCommittedAt = null;
    }
    const requestFrameUrl = requestFrame ? requestFrame.url() : null;
    currentBrowserSessionId = browserSessionIdAfterRequest(
      currentBrowserSessionId,
      request.method(),
      requestUrl.pathname,
    );
    if (isBrowserSessionClaimRequest(request.method(), requestUrl.pathname)) {
      inFlightBrowserSessionClaims.set(request, {
        startedAt,
        responseStatus: null,
      });
    }
    if (
      [
        "/_agent-native/actions/get-lab-states",
        "/_agent-native/actions/get-deck-access-status",
      ].includes(requestUrl.pathname) ||
      isBrowserSessionPath(requestUrl.pathname)
    ) {
      watchedRequests.set(request, startedAt);
    }
    const requestStartedDuringNavigation =
      activePhase === "save/reload" &&
      reloadNavigationStartedAt !== null &&
      startedAt >= reloadNavigationStartedAt &&
      startedAt - reloadNavigationStartedAt <
        reloadNavigationAbortMaxRequestAgeMs &&
      isBrowserSessionPath(requestUrl.pathname);
    const requestStartedAfterNavigation =
      activePhase === "save/reload" &&
      reloadNavigationStartedAt === null &&
      lastReloadStartedAt !== null &&
      startedAt >= lastReloadStartedAt &&
      startedAt - lastReloadStartedAt < reloadNavigationConsoleGraceMs &&
      isBrowserSessionPath(requestUrl.pathname);
    if (requestStartedDuringNavigation || requestStartedAfterNavigation) {
      const sessionIdentity = browserSessionNavigationRequestIdentity(
        request.method(),
        requestUrl.pathname,
        request.postData(),
      );
      const identifiedSession =
        sessionIdentity?.status === "identified" ? sessionIdentity : null;
      reloadNavigationRequests.set(request, {
        startedAt,
        settledAt: null,
        finishedSuccessfully: false,
        responseStatus: null,
        requestWasPendingAtNavigation: false,
        completedSuccessfullyBeforeNavigation: false,
        completedBeforeNavigationAgeMs: null,
        requestStartedDuringNavigation,
        requestStartedAfterNavigation,
        requestSequence,
        resourceType: request.resourceType(),
        requestSourceIsMainFrame,
        requestFrameUrl,
        outgoingDocumentUrl: outgoingDocumentUrlAtReload,
        outgoingRequestKind: identifiedSession?.kind ?? null,
        requestSessionId: identifiedSession?.sessionId ?? null,
        mainFrameNavigationStartedAt,
        mainFrameNavigationRequestSequence,
        requestStartedBeforeMainFrameCommit:
          requestSourceIsMainFrame &&
          mainFrameNavigationRequestSequence !== null &&
          requestSequence > mainFrameNavigationRequestSequence &&
          mainFrameNavigationCommittedAt === null,
        // Reset when the reload begins, so null means the reloaded document has
        // not committed and this request still belongs to the retired one even
        // when it was issued before the navigation request itself was seen.
        requestStartedBeforeReloadCommit:
          requestStartedDuringNavigation &&
          mainFrameNavigationCommittedAt === null,
        retiredSessionId: browserSessionIdAtReload,
        failureAt: null,
        failureText: null,
        pendingOutgoingAbort: false,
        outgoingNavigationAbort: false,
      });
    }
    if (!traceEnabled) return;
    pendingRequests.set(request, {
      method: request.method(),
      path: requestUrl.pathname,
      startedAt,
    });
    if (
      [
        "/_agent-native/actions/get-lab-states",
        "/_agent-native/actions/get-deck-access-status",
      ].includes(requestUrl.pathname)
    ) {
      console.log(
        `[edit-fidelity] navigation candidate request ${request.method()} ${requestUrl.href} phase=${activePhase}`,
      );
    }
  };
  const onRequestSettled = (request: any) => {
    pendingRequests.delete(request);
    watchedRequests.delete(request);
    const settledAt = Date.now();
    const claim = inFlightBrowserSessionClaims.get(request);
    if (claim) {
      if (
        claim.responseStatus !== null &&
        claim.responseStatus >= 200 &&
        claim.responseStatus < 300
      ) {
        for (const [
          completedRequest,
          completedClaim,
        ] of recentlyCompletedBrowserSessionClaims.entries()) {
          if (
            settledAt - completedClaim.settledAt >=
            reloadNavigationSuccessfulClaimGraceMs
          ) {
            recentlyCompletedBrowserSessionClaims.delete(completedRequest);
          }
        }
        recentlyCompletedBrowserSessionClaims.set(request, {
          startedAt: claim.startedAt,
          settledAt,
          responseStatus: claim.responseStatus,
        });
      }
      inFlightBrowserSessionClaims.delete(request);
    }
    const candidate = reloadNavigationRequests.get(request);
    // WebKit can deliver the fetch error after Playwright's requestfinished event.
    if (candidate) {
      candidate.settledAt = settledAt;
      candidate.finishedSuccessfully = true;
      candidate.responseStatus =
        claim?.responseStatus ?? candidate.responseStatus;
    }
  };
  const onResponse = (response: any) => {
    const request = response.request();
    const claim = inFlightBrowserSessionClaims.get(request);
    if (claim) claim.responseStatus = response.status();
    const navigationCandidate = reloadNavigationRequests.get(request);
    if (navigationCandidate) {
      navigationCandidate.responseStatus = response.status();
    }
    if (traceEnabled) {
      const responseUrl = new URL(response.url());
      if (
        [
          "/_agent-native/actions/get-lab-states",
          "/_agent-native/actions/get-deck-access-status",
        ].includes(responseUrl.pathname)
      ) {
        console.log(
          `[edit-fidelity] navigation candidate response ${response.status()} ${responseUrl.href} phase=${activePhase}`,
        );
      }
    }
    if (response.status() !== 409) return;
    const responsePath = new URL(response.url()).pathname;
    conflictResponsePaths.push(responsePath);
    if (responsePath !== patchDeckActionPath) return;
    patchDeckConflicts += 1;
    pendingSaveConflicts.push(
      response
        .text()
        .then(() => undefined)
        .catch((error: unknown) => {
          pageErrors.push(
            `patch-deck conflict response could not be read: ${String(error)}`,
          );
        }),
    );
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("request", onRequest);
  page.on("requestfinished", onRequestSettled);
  page.on("framenavigated", onFrameNavigated);
  await page.evaluate((traceHeartbeat: boolean) => {
    const scope = window as Window & {
      __slidesAuthoringInputTrace?: Array<Record<string, unknown>>;
      __slidesAuthoringInputTraceInstalled?: boolean;
    };
    if (scope.__slidesAuthoringInputTraceInstalled) return;
    const trace: Array<Record<string, unknown>> = [];
    const record = (event: Event) => {
      if (!(event instanceof InputEvent)) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const root =
        target instanceof Element
          ? target.closest<HTMLElement>(
              '[contenteditable="true"][data-editing-block="true"]',
            )
          : target.parentElement?.closest<HTMLElement>(
              '[contenteditable="true"][data-editing-block="true"]',
            );
      if (!root) return;
      const data = event.data;
      const relevant =
        event.inputType === "insertReplacementText" ||
        data === null ||
        data === "" ||
        /[ \u00a0\-+*_~`\/]/u.test(data);
      if (!relevant) return;
      const lastCodePoint = data?.codePointAt(data.length - 1);
      trace.push({
        type: event.type,
        inputType: event.inputType,
        dataLength: data?.length ?? null,
        lastCodePoint: lastCodePoint?.toString(16) ?? null,
        cancelable: event.cancelable,
        composing: event.isComposing,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
      });
      if (trace.length > 100) trace.shift();
    };
    document.addEventListener("beforeinput", record, true);
    document.addEventListener("input", record, true);
    scope.__slidesAuthoringInputTraceInstalled = true;
    scope.__slidesAuthoringInputTrace = trace;
    if (traceHeartbeat) {
      let heartbeat = 0;
      window.setInterval(() => {
        console.debug(`[authoring-fuzz heartbeat] ${++heartbeat}`);
      }, 5000);
    }
  }, traceEnabled);

  const tracePhase = (phase: string) => {
    if (!traceEnabled) return;
    console.log(
      `[edit-fidelity] trace seed=${seed} step=${activeIndex} operation=${plan[activeIndex]?.kind ?? "setup"} phase=${phase} at=${Date.now()}`,
    );
  };
  const traceWatchdog = traceEnabled
    ? setInterval(() => {
        const pending = [...pendingRequests.values()]
          .filter((request) => Date.now() - request.startedAt >= 10_000)
          .map(
            (request) =>
              `${request.method} ${request.path} ${Date.now() - request.startedAt}ms`,
          );
        console.log(
          `[edit-fidelity] trace seed=${seed} node-heartbeat step=${activeIndex} operation=${plan[activeIndex]?.kind ?? "setup"} phase=${activePhase} pending=${pending.length ? pending.join(" | ") : "none"}`,
        );
      }, 15_000)
    : null;
  const replay = () => plan.slice(0, Math.max(1, activeIndex + 1));
  const drainRetiredSessionErrors = async () => {
    while (true) {
      const waitMs = retiredSessionErrorCorrelator.nextExpiryDelay(Date.now());
      if (waitMs === null) return;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      pageErrors.push(
        ...retiredSessionErrorCorrelator.flushExpired(Date.now()),
      );
    }
  };
  const checkPageErrors = async () => {
    await Promise.all(pendingSaveConflicts.splice(0));
    while (pendingConsoleInspections.size) {
      await Promise.all([...pendingConsoleInspections]);
    }
    await drainRetiredSessionErrors();
    if (pageErrors.length)
      throw new Error(
        `browser emitted ${pageErrors.length} console/page error(s): ${pageErrors
          .slice(0, 2)
          .map((error) => error.replaceAll(/\s+/g, " ").slice(0, 700))
          .join("; ")}`,
      );
  };
  const inspectSelection = async () =>
    page.evaluate((selector: string) => {
      const root = document.querySelector(selector);
      const selection = window.getSelection();
      if (
        !(root instanceof HTMLElement) ||
        !selection ||
        !selection.rangeCount
      ) {
        return { inside: false, collapsed: false, text: "", start: 0, end: 0 };
      }
      const range = selection.getRangeAt(0);
      const offset = (node: Node, at: number) => {
        const prefix = document.createRange();
        prefix.selectNodeContents(root);
        prefix.setEnd(node, at);
        return prefix
          .toString()
          .replaceAll("\u200b", "")
          .replaceAll("\u00a0", " ").length;
      };
      return {
        inside:
          root.contains(selection.anchorNode) &&
          root.contains(selection.focusNode),
        collapsed: selection.isCollapsed,
        text: (root.textContent ?? "")
          .replaceAll("\u200b", "")
          .replaceAll("\u00a0", " "),
        start: offset(range.startContainer, range.startOffset),
        end: offset(range.endContainer, range.endOffset),
      };
    }, editorSelector);
  const slashCount = (text: string) => text.match(/\//g)?.length ?? 0;
  const assertCaret = async () => {
    const selection = await inspectSelection();
    if (!selection.inside)
      throw new Error("selection/caret left the edited element");
  };
  const slideScrollState = async (): Promise<SlideScrollState | null> =>
    page.evaluate((selector: string) => {
      const canvas = document.querySelector(selector);
      if (!canvas) return null;
      const slide = canvas.querySelector<HTMLElement>(".fmd-slide");
      if (!slide) return null;
      const canvasRect = canvas.getBoundingClientRect();
      const rect = slide.getBoundingClientRect();
      const editor = canvas.querySelector<HTMLElement>(
        '[contenteditable="true"][data-editing-block="true"]',
      );
      const editorAncestors: Array<Record<string, unknown>> = [];
      for (
        let current: HTMLElement | null = editor;
        current && slide.contains(current);
        current = current.parentElement
      ) {
        const currentRect = current.getBoundingClientRect();
        const index = current.parentElement
          ? Array.from(current.parentElement.children).indexOf(current)
          : 0;
        editorAncestors.push({
          key: `${current.tagName}:${current.className}:${index}`,
          scrollTop: current.scrollTop,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight,
          offsetHeight: current.offsetHeight,
          rect: {
            x: currentRect.x,
            y: currentRect.y,
            width: currentRect.width,
            height: currentRect.height,
          },
        });
      }
      const scrollAncestors: Array<Record<string, unknown>> = [];
      for (
        let current: HTMLElement | null = slide;
        current && scrollAncestors.length < 8;
        current = current.parentElement
      ) {
        const ancestorRect = current.getBoundingClientRect();
        scrollAncestors.push({
          tag: current.tagName,
          className: current.className,
          scrollTop: current.scrollTop,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight,
          rect: {
            x: ancestorRect.x,
            y: ancestorRect.y,
            width: ancestorRect.width,
            height: ancestorRect.height,
          },
        });
      }
      const fit = canvas
        ? (Array.from(
            canvas.querySelectorAll<HTMLElement>(".fmd-autofit-scale"),
          ).find(
            (element) => element.className.trim() === "fmd-autofit-scale",
          ) ?? canvas.querySelector<HTMLElement>(".fmd-autofit-scale"))
        : null;
      const fitRect = fit?.getBoundingClientRect();
      const fitStyle = fit ? getComputedStyle(fit) : null;
      const fitLayers = canvas
        ? Array.from(
            canvas.querySelectorAll<HTMLElement>(".fmd-autofit-scale"),
          ).map((element) => {
            const elementRect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const parentRect = element.parentElement?.getBoundingClientRect();
            return {
              className: element.className,
              autofitContent: element.hasAttribute("data-fmd-autofit-content"),
              autofitActive: element.hasAttribute("data-fmd-autofit-active"),
              rect: {
                x: elementRect.x,
                y: elementRect.y,
                width: elementRect.width,
                height: elementRect.height,
              },
              transform: style.transform,
              fitScale: style.getPropertyValue("--fmd-fit-scale"),
              fitX: style.getPropertyValue("--fmd-fit-x"),
              fitY: style.getPropertyValue("--fmd-fit-y"),
              parentClassName: element.parentElement?.className ?? "",
              parentY: parentRect?.y ?? 0,
            };
          })
        : [];
      return {
        canvasRect: {
          x: canvasRect.x,
          y: canvasRect.y,
          width: canvasRect.width,
          height: canvasRect.height,
        },
        scrollTop: slide.scrollTop,
        scrollHeight: slide.scrollHeight,
        clientHeight: slide.clientHeight,
        offsetHeight: slide.offsetHeight,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        scrollAncestors,
        documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
        editorAncestors,
        fit:
          fitRect && fitStyle
            ? {
                x: fitRect.x,
                y: fitRect.y,
                width: fitRect.width,
                height: fitRect.height,
                transform: fitStyle.transform,
                transformOrigin: fitStyle.transformOrigin,
                top: fitStyle.top,
                left: fitStyle.left,
                right: fitStyle.right,
                bottom: fitStyle.bottom,
                position: fitStyle.position,
                marginTop: fitStyle.marginTop,
                marginBottom: fitStyle.marginBottom,
                alignSelf: fitStyle.alignSelf,
                fitScale: fitStyle.getPropertyValue("--fmd-fit-scale"),
                fitX: fitStyle.getPropertyValue("--fmd-fit-x"),
                fitY: fitStyle.getPropertyValue("--fmd-fit-y"),
              }
            : null,
        fitLayers,
      };
    }, slideSelector);
  let outsideBaseline: OutsideSnapshot | null = null;
  let slideScrollBaseline: SlideScrollState | null = null;
  const typeBurst = async (value: string, verifyPlacement: boolean) => {
    if (!value) return;
    const before = await inspectSelection();
    if (!before.inside)
      throw new Error("cannot type: selection is outside the edited element");
    await editor.pressSequentially(value, { delay: 0 });
    const after = await inspectSelection();
    if (!after.inside)
      throw new Error(
        `typed burst ${JSON.stringify(value)} outside the editor`,
      );
    if (verifyPlacement) {
      const expected =
        before.text.slice(0, before.start) +
        value +
        before.text.slice(before.end);
      const textMismatch = Array.from(
        { length: Math.max(expected.length, after.text.length) },
        (_, index) => index,
      ).find((index) => expected[index] !== after.text[index]);
      if (
        after.text !== expected ||
        after.start !== before.start + value.length
      ) {
        throw new Error(
          `typed burst ${JSON.stringify(value)} missed the caret (expected offset ${before.start + value.length}, got ${after.start}; text lengths ${expected.length} and ${after.text.length}; selection=${before.collapsed}:${before.start}-${before.end} to ${after.collapsed}:${after.start}-${after.end}; first mismatch=${textMismatch ?? "none"} codes=${textMismatch === undefined ? "none" : `${expected.codePointAt(textMismatch)}>${after.text.codePointAt(textMismatch)}`})`,
        );
      }
    }
  };
  const typeText = async (
    value: string,
    verifyPlacement = true,
    skipLastPlacement = false,
  ) => {
    const payload = skipLastPlacement ? value.slice(0, -1) : value;
    const trigger = skipLastPlacement ? value.slice(-1) : "";
    await typeBurst(payload, verifyPlacement);
    if (trigger) await typeBurst(trigger, false);
  };
  const snapshotOutside = async (): Promise<OutsideSnapshot> =>
    page.evaluate(
      ({ slide, editor }: { slide: string; editor: string }) => {
        const root = document.querySelector(slide);
        const editing = document.querySelector(editor);
        if (!root || !editing || !root.contains(editing)) {
          throw new Error(
            "slide/editor selectors must resolve inside the same slide",
          );
        }
        return window.__editFidelity.outsideSnapshot(slide);
      },
      { slide: slideSelector, editor: editorSelector },
    );
  const snapshotEditorSiblings = async (
    phase: "capture" | "assert",
    operation: AuthoringFuzzOperation,
    requireMerge = false,
  ) => {
    const result = await page.evaluate(
      ({
        selector,
        phase,
        operation,
        requireMerge,
        listTag,
        styleProperties,
      }: {
        selector: string;
        phase: "capture" | "assert";
        operation: AuthoringFuzzOperation;
        requireMerge: boolean;
        listTag: "OL" | "UL" | null;
        styleProperties: string[];
      }) => {
        const root = document.querySelector(selector);
        const selection = window.getSelection();
        if (!(root instanceof HTMLElement) || !selection?.rangeCount) {
          throw new Error("cannot snapshot editor siblings without a caret");
        }
        const scope = window as Window & {
          __authoringFuzzSiblingSnapshot?: {
            root: HTMLElement;
            records: Array<{
              node: Element | Text;
              parent: Node;
              index: number;
              order?: number;
              styleValues: Record<string, string>;
              attributes: string;
              attributeNames: string;
              contentSignature: string;
              childShape: string;
              emptyInlineLink: boolean;
            }>;
            targets: HTMLElement[];
            originalListRows: Element[];
            emptyListExit?: {
              list: HTMLElement;
              item: HTMLElement;
              expectedMoves: Element[];
              paragraphs: HTMLElement[];
              listStyles: Record<string, string>;
              listAttributes: string;
            };
            listMerge?: {
              tagName: "OL" | "UL";
              originalRows: Element[];
              adjacent: Array<{
                side: "before" | "after";
                node: HTMLElement;
                rows: HTMLElement[];
                attributes: string;
                styles: Record<string, string>;
              }>;
            };
            merge?: {
              direction: "backward" | "forward";
              source: HTMLElement;
              receiver: HTMLElement;
              parent: Node;
              receiverText: string;
              sourceText: string;
              sourceFormatting: Array<{ text: string; marks: string[] }>;
              receiverFormatting: Array<{ text: string; marks: string[] }>;
              receiverAttributes: string;
              receiverStyles: Record<string, string>;
            };
          };
        };
        const block =
          /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
        const previous = scope.__authoringFuzzSiblingSnapshot;
        const range = selection.getRangeAt(0);
        const listShortcut =
          operation.kind === "shortcut" &&
          (operation.result === "bullet" || operation.result === "ordered");
        let targets = selection.isCollapsed
          ? (() => {
              let current =
                selection.anchorNode instanceof HTMLElement
                  ? selection.anchorNode
                  : selection.anchorNode?.parentElement;
              while (
                current &&
                current !== root &&
                !block.test(current.tagName)
              ) {
                current = current.parentElement;
              }
              return current && current !== root ? [current] : [root];
            })()
          : Array.from(root.querySelectorAll<HTMLElement>("*"))
              .filter((element) => block.test(element.tagName))
              .filter((element) => {
                return range.intersectsNode(element);
              })
              .filter(
                (element, _, all) =>
                  !all.some(
                    (candidate) =>
                      candidate !== element && element.contains(candidate),
                  ),
              );
        if (
          phase === "capture" &&
          operation.kind === "delete-list-edge" &&
          targets[0]?.tagName === "LI"
        ) {
          const followingItem = targets[0].nextElementSibling;
          if (followingItem?.tagName === "LI")
            targets.push(followingItem as HTMLElement);
        }
        if (phase === "capture" && operation.kind === "backspace-list-edge") {
          const isStyledBulletRow = (element: Element | null) => {
            const marker = element?.firstElementChild;
            return (
              element?.tagName === "DIV" &&
              getComputedStyle(element).display === "flex" &&
              marker?.tagName === "SPAN" &&
              /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
              element.lastElementChild?.tagName === "SPAN"
            );
          };
          const row = targets[0];
          const previousRow = row?.previousElementSibling;
          if (isStyledBulletRow(row) && isStyledBulletRow(previousRow)) {
            targets.unshift(previousRow as HTMLElement);
          }
        }
        const activeItem =
          targets[0]?.tagName === "LI" ? targets[0] : targets[0]?.closest("li");
        const activeList = activeItem?.parentElement ?? null;
        if (
          ((operation.kind === "slash" &&
            (operation.value === "bulletList" ||
              operation.value === "orderedList")) ||
            listShortcut) &&
          activeList?.matches("ol, ul")
        ) {
          if (operation.kind === "slash") {
            // The list command changes the active list node as a unit.
            targets = [activeList];
          }
        }
        if (!targets.length) targets.push(root);
        if (
          phase === "assert" &&
          (operation.kind === "backspace-block-edge" ||
            operation.kind === "delete-block-edge" ||
            operation.kind === "empty-list-exit" ||
            previous?.listMerge) &&
          previous?.root === root
        ) {
          targets = previous.targets;
        }
        const isTarget = (node: Node) =>
          targets.some(
            (target) =>
              target === node ||
              target.contains(node) ||
              (node instanceof Element && node.contains(target)),
          );
        const siblingText = new Set<Text>();
        const textOnlyStyles = new Set([
          "color",
          "font-family",
          "font-size",
          "font-style",
          "font-weight",
          "letter-spacing",
          "text-decoration",
          "text-decoration-color",
          "text-decoration-line",
          "text-decoration-style",
          "text-decoration-thickness",
          "text-shadow",
          "text-underline-offset",
          "vertical-align",
        ]);
        for (const target of targets) {
          let current: Node = target;
          while (current !== root && current.parentNode) {
            const parent: Node = current.parentNode;
            for (const sibling of Array.from(parent.childNodes)) {
              if (sibling !== current && sibling instanceof Text) {
                siblingText.add(sibling);
              }
            }
            if (parent === root) break;
            current = parent;
          }
        }
        const names = new Set([
          ...styleProperties,
          ...window.__editFidelity.customStyleProperties(root),
        ]);
        const stylePropertyNames = [...names].sort();
        const styleValues = (element: Element) => {
          const style = getComputedStyle(element);
          return Object.fromEntries(
            stylePropertyNames.map((property) => [
              property,
              style.getPropertyValue(property),
            ]),
          ) as Record<string, string>;
        };
        const authoredAttributes = (element: Element) =>
          Array.from(element.attributes)
            .map(({ name, value }) => `${name}=${value}`)
            .sort()
            .join("\n");
        const visibleText = (value: string) =>
          value.replaceAll(/[\u200b\ufeff]/g, "").replaceAll("\u00a0", " ");
        const inlineFormatting = (
          block: HTMLElement,
          start = 0,
          end = Number.POSITIVE_INFINITY,
        ) => {
          const runs: Array<{ text: string; marks: string[] }> = [];
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          let offset = 0;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            const value = visibleText(text.data);
            const from = Math.max(start, offset);
            const to = Math.min(end, offset + value.length);
            if (from < to) {
              const marks: string[] = [];
              for (
                let current = text.parentElement;
                current && current !== block;
                current = current.parentElement
              ) {
                marks.unshift(
                  `${current.tagName}:${authoredAttributes(current)}`,
                );
              }
              const slice = value.slice(from - offset, to - offset);
              const previousRun = runs.at(-1);
              if (
                previousRun &&
                JSON.stringify(previousRun.marks) === JSON.stringify(marks)
              ) {
                previousRun.text += slice;
              } else {
                runs.push({ text: slice, marks });
              }
            }
            offset += value.length;
          }
          return runs;
        };
        const merge =
          phase === "capture"
            ? (() => {
                const direction: "backward" | "forward" | null =
                  operation.kind === "backspace-block-edge"
                    ? "backward"
                    : operation.kind === "delete-block-edge"
                      ? "forward"
                      : null;
                if (!direction) return undefined;
                const receiver =
                  direction === "backward"
                    ? targets[0]?.previousElementSibling
                    : targets[0];
                const source =
                  direction === "backward"
                    ? targets[0]
                    : receiver?.nextElementSibling;
                return receiver instanceof HTMLElement &&
                  source instanceof HTMLElement &&
                  receiver !== root &&
                  source !== root &&
                  receiver.tagName === "P" &&
                  source.tagName === "P" &&
                  root.contains(receiver) &&
                  root.contains(source) &&
                  receiver.parentNode === source.parentNode
                  ? {
                      direction,
                      source,
                      receiver,
                      parent: receiver.parentNode as Node,
                      receiverText: receiver.textContent ?? "",
                      sourceText: source.textContent ?? "",
                      sourceFormatting: inlineFormatting(source),
                      receiverFormatting: inlineFormatting(receiver),
                      receiverAttributes: authoredAttributes(receiver),
                      receiverStyles: styleValues(receiver),
                    }
                  : undefined;
              })()
            : previous?.merge;
        const isEmptyInlineLink = (element: Element) =>
          element.tagName === "A" &&
          element.attributes.length === 0 &&
          element.childNodes.length === 0 &&
          !element.textContent &&
          getComputedStyle(element).display === "inline" &&
          ["::before", "::after"].every((pseudo) =>
            ["none", "normal"].includes(
              getComputedStyle(element, pseudo).content,
            ),
          );
        const changedStyleProperties = (
          element: Element,
          before: Record<string, string>,
        ) => {
          const style = getComputedStyle(element);
          const changes: string[] = [];
          for (const property of stylePropertyNames) {
            if (
              property === "transform-origin" &&
              ["transform", "translate", "rotate", "scale"].every(
                (transformProperty) =>
                  before[transformProperty] === "none" &&
                  style.getPropertyValue(transformProperty) === "none",
              )
            ) {
              continue;
            }
            if ((before[property] ?? "") !== style.getPropertyValue(property)) {
              changes.push(property);
            }
          }
          return changes;
        };
        const chrome = [
          "[data-slide-selection-chrome]",
          "[data-slide-selection-outline]",
          "[data-slide-resize-handle]",
          "[data-slide-move-handle]",
          "[data-slide-rotate-handle]",
          "[data-block-bubble-menu]",
        ].join(",");
        const records: NonNullable<
          typeof scope.__authoringFuzzSiblingSnapshot
        >["records"] = [];
        const isEditorInlineStyleSpan = (element: Element) =>
          element.tagName === "SPAN" &&
          element.getAttribute("data-slide-inline-style") === "true" &&
          Array.from(element.attributes).every(
            ({ name, value }) =>
              name === "style" ||
              (name === "data-slide-inline-style" && value === "true"),
          ) &&
          getComputedStyle(element).display === "inline" &&
          ["::before", "::after"].every((pseudo) =>
            ["none", "normal"].includes(
              getComputedStyle(element, pseudo).content,
            ),
          ) &&
          Array.from((element as HTMLElement).style).every((property) =>
            textOnlyStyles.has(property),
          );
        const contentSignature = (element: Element) =>
          element.textContent ?? "";
        const childShape = (element: Element) => {
          const describe = (node: Node): string[] => {
            if (node instanceof Text) return ["#text"];
            if (node instanceof Element && isEditorInlineStyleSpan(node)) {
              return Array.from(node.childNodes).flatMap(describe);
            }
            return [`@${node.nodeName}`];
          };
          return Array.from(element.childNodes).flatMap(describe).join("");
        };
        const order = new Map(
          Array.from(root.querySelectorAll<Element>("*")).map(
            (element, index) => [element, index] as const,
          ),
        );
        const isBulletRow = (element: Element | null) =>
          !!element &&
          ["DIV", "LI", "P"].includes(element.tagName) &&
          !!element.firstElementChild &&
          /^[•●◦▪‣·⁃*+\-–—]$/.test(
            (element.firstElementChild.textContent ?? "").trim(),
          );
        const isListGroup = (element: Element) => {
          const rows = [
            element,
            ...Array.from(element.querySelectorAll("*")),
          ].filter(isBulletRow);
          if (!rows.length) return false;
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (
              (node as Text).data.trim() &&
              !rows.some((row) => row.contains(node))
            ) {
              return false;
            }
          }
          return true;
        };
        const isListContainer = (node: Node) =>
          node instanceof Element &&
          (/^(OL|UL)$/.test(node.tagName) ||
            (node.tagName === "DIV" && isListGroup(node)));
        const isListItem = (node: Node) =>
          node instanceof Element &&
          (node.tagName === "LI" || isListGroup(node));
        const originalListRows = new Set<Element>();
        if (phase === "assert" && previous?.root === root) {
          previous.originalListRows.forEach((row) => originalListRows.add(row));
        } else if (listShortcut) {
          for (const target of targets) {
            let candidate = target.parentElement;
            while (candidate && candidate !== root) {
              if (isListContainer(candidate)) {
                const rows = Array.from(candidate.children).filter(isListItem);
                if (
                  rows.some((row) => row === target || row.contains(target))
                ) {
                  rows.forEach((row) => originalListRows.add(row));
                  break;
                }
              }
              candidate = candidate.parentElement;
            }
          }
        }
        const emptyListExit =
          phase === "capture" &&
          operation.kind === "empty-list-exit" &&
          activeItem &&
          activeList &&
          /^(OL|UL)$/.test(activeList.tagName)
            ? (() => {
                const rows = Array.from(activeList.children).filter(
                  (child) => child.tagName === "LI",
                );
                const itemIndex = rows.indexOf(activeItem);
                if (itemIndex < 0) {
                  throw new Error(
                    "empty-list-exit setup could not find its active list item",
                  );
                }
                const before = rows.slice(0, itemIndex);
                const after = rows.slice(itemIndex + 1);
                const expectedMoves =
                  activeList === root
                    ? rows.filter((row) => row !== activeItem)
                    : before.length && after.length
                      ? after
                      : [];
                return {
                  list: activeList,
                  item: activeItem,
                  expectedMoves,
                  paragraphs: [
                    ...(root.matches("p") ? [root] : []),
                    ...root.querySelectorAll<HTMLElement>("p"),
                  ],
                  listStyles: styleValues(activeList),
                  listAttributes: authoredAttributes(activeList),
                };
              })()
            : phase === "assert"
              ? previous?.emptyListExit
              : undefined;
        const listMerge =
          phase === "capture" &&
          listTag &&
          targets[0] instanceof HTMLElement &&
          targets[0] !== root &&
          !targets[0].closest("li,ol,ul")
            ? (() => {
                const target = targets[0] as HTMLElement;
                const adjacent = [
                  {
                    side: "before" as const,
                    node: target.previousElementSibling,
                  },
                  {
                    side: "after" as const,
                    node: target.nextElementSibling,
                  },
                ]
                  .filter(
                    (
                      candidate,
                    ): candidate is {
                      side: "before" | "after";
                      node: HTMLElement;
                    } =>
                      candidate.node instanceof HTMLElement &&
                      candidate.node.tagName === listTag,
                  )
                  .map(({ side, node }) => ({
                    side,
                    node,
                    rows: Array.from(node.children).filter(
                      (child): child is HTMLElement =>
                        child instanceof HTMLElement && child.tagName === "LI",
                    ),
                    attributes: authoredAttributes(node),
                    styles: styleValues(node),
                  }));
                return adjacent.length
                  ? {
                      tagName: listTag,
                      originalRows: Array.from(
                        root.querySelectorAll<HTMLElement>("li"),
                      ),
                      adjacent,
                    }
                  : undefined;
              })()
            : phase === "assert"
              ? previous?.listMerge
              : undefined;
        const isEmptyAuthorStyleSpan = (element: Element): boolean =>
          isEditorInlineStyleSpan(element) &&
          !element.textContent &&
          Array.from(element.children).every(isEmptyAuthorStyleSpan);
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          if (
            isTarget(element) ||
            element.closest(chrome) ||
            !element.parentNode
          ) {
            continue;
          }
          if (isEmptyAuthorStyleSpan(element)) continue;
          records.push({
            node: element,
            parent: element.parentNode,
            index: Array.from(element.parentNode.childNodes).indexOf(element),
            order: order.get(element),
            styleValues: styleValues(element),
            attributes: `${element.getAttribute("class") ?? ""}:${element.getAttribute("style") ?? ""}`,
            attributeNames: Array.from(element.attributes)
              .map(({ name }) => name)
              .sort()
              .join(" "),
            contentSignature: contentSignature(element),
            childShape: childShape(element),
            emptyInlineLink: isEmptyInlineLink(element),
          });
        }
        for (const text of siblingText) {
          const parent = text.parentElement;
          if (!parent || !text.data || isTarget(text) || !root.contains(text)) {
            continue;
          }
          records.push({
            node: text,
            parent,
            index: Array.from(parent.childNodes).indexOf(text),
            styleValues: styleValues(parent),
            attributes: "",
            attributeNames: "",
            contentSignature: text.data,
            childShape: "",
            emptyInlineLink: false,
          });
        }
        if (phase === "capture") {
          if (
            requireMerge &&
            (operation.kind === "backspace-block-edge" ||
              operation.kind === "delete-block-edge") &&
            !merge
          ) {
            throw new Error(
              `block-edge ${operation.kind === "backspace-block-edge" ? "Backspace" : "Delete"} setup did not create adjacent paragraphs inside the editing root`,
            );
          }
          if (
            requireMerge &&
            merge &&
            (!merge.sourceText.trim() ||
              !merge.sourceFormatting.some(
                ({ text, marks }) => text.trim() && marks.length > 0,
              ) ||
              !merge.receiverText.trim() ||
              !merge.receiverFormatting.some(
                ({ text, marks }) => text.trim() && marks.length > 0,
              ))
          ) {
            throw new Error(
              "block-edge setup needs non-empty source and receiver paragraphs with inline formatting",
            );
          }
          scope.__authoringFuzzSiblingSnapshot = {
            root,
            records,
            targets: [...targets],
            originalListRows: [...originalListRows],
            emptyListExit,
            listMerge,
            merge,
          };
          return { failures: [], listIdentityChecks: [] };
        }
        const baseline = previous;
        if (!baseline) {
          throw new Error("editor sibling snapshot was not captured");
        }
        const failures: string[] = [];
        const listIdentityChecks: Array<{
          candidateId: string;
          resultId: string | null;
        }> = [];
        const mergeAssertion =
          baseline.merge &&
          ((operation.kind === "backspace-block-edge" &&
            baseline.merge.direction === "backward") ||
            (operation.kind === "delete-block-edge" &&
              baseline.merge.direction === "forward"))
            ? baseline.merge
            : undefined;
        if (
          (operation.kind === "backspace-block-edge" ||
            operation.kind === "delete-block-edge") &&
          !mergeAssertion
        ) {
          failures.push("block-edge operation did not capture its block pair");
        }
        const mergedListContainers = new Set<Element>();
        const mergedListRows = new Set<Element>();
        const mergedListContainerContentChanges = new Set<Element>();
        if (
          baseline.listMerge &&
          listTag === baseline.listMerge.tagName &&
          activeList?.tagName === baseline.listMerge.tagName &&
          activeItem
        ) {
          const resultRows = Array.from(activeList.children).filter(
            (child) => child.tagName === "LI",
          );
          const generatedRows = resultRows.filter(
            (row) => !baseline.listMerge?.originalRows.includes(row),
          );
          const expectedGeneratedRows = operation.kind === "list" ? 2 : 1;
          const generatedIndexes = generatedRows.map((row) =>
            resultRows.indexOf(row),
          );
          const generatedRowsAreContiguous = generatedIndexes.every(
            (index, position) =>
              position === 0 || index === generatedIndexes[position - 1]! + 1,
          );
          const generatedRowsContainCaret = generatedRows.includes(activeItem);
          const compatibleAttributes = (element: Element) =>
            Array.from(element.attributes)
              .filter(({ name }) => name !== "id")
              .map(({ name, value }) => `${name}=${value}`)
              .sort()
              .join("\n");
          if (
            generatedRows.length === expectedGeneratedRows &&
            generatedRowsAreContiguous &&
            generatedRowsContainCaret
          ) {
            const firstGeneratedIndex = generatedIndexes[0] ?? -1;
            const lastGeneratedIndex = generatedIndexes.at(-1) ?? -1;
            for (const candidate of baseline.listMerge.adjacent) {
              const rowIndexes = candidate.rows.map((row) =>
                resultRows.indexOf(row),
              );
              const rowsPreserved = rowIndexes.every(
                (index, position) =>
                  index >= 0 &&
                  (position === 0 || index === rowIndexes[position - 1]! + 1),
              );
              const rowsOnExpectedSide =
                candidate.side === "before"
                  ? rowIndexes.every((index) => index < firstGeneratedIndex)
                  : rowIndexes.every((index) => index > lastGeneratedIndex);
              const sameListAttributes =
                compatibleAttributes(candidate.node) ===
                compatibleAttributes(activeList);
              const sourceAttributesPreserved =
                authoredAttributes(candidate.node) === candidate.attributes;
              const listWasMerged =
                candidate.node === activeList || !root.contains(candidate.node);
              if (
                candidate.side === "before" &&
                candidate.node.hasAttribute("id") &&
                listWasMerged
              ) {
                listIdentityChecks.push({
                  candidateId: candidate.node.getAttribute("id") ?? "",
                  resultId: activeList.getAttribute("id"),
                });
              }
              const leftListCarriesIdentity =
                candidate.side !== "after" ||
                !candidate.node.hasAttribute("id");
              const resultStyleMatches =
                changedStyleProperties(activeList, candidate.styles).length ===
                0;
              if (
                candidate.node.tagName === baseline.listMerge.tagName &&
                sameListAttributes &&
                sourceAttributesPreserved &&
                listWasMerged &&
                leftListCarriesIdentity &&
                rowsPreserved &&
                rowsOnExpectedSide &&
                resultStyleMatches
              ) {
                mergedListContainers.add(candidate.node);
                candidate.rows.forEach((row) => mergedListRows.add(row));
                if (candidate.node === activeList) {
                  mergedListContainerContentChanges.add(candidate.node);
                }
              }
            }
          }
        }
        const path = (node: Node) => {
          const parts: string[] = [];
          for (
            let current: Node | null = node;
            current && current !== root;
            current = current.parentNode
          ) {
            const parent = current.parentNode;
            const index = parent
              ? Array.from(parent.childNodes).findIndex(
                  (child) => child === current,
                )
              : -1;
            parts.unshift(`${current.nodeName}[${index}]`);
          }
          return parts.join("/");
        };
        const targetPaths = targets.map(path).join(", ");
        const equivalentReplacements = new Set<Element>();
        for (const record of baseline.records) {
          if (isTarget(record.node)) continue;
          if (
            record.node instanceof Element &&
            mergedListContainers.has(record.node) &&
            record.node !== activeList
          ) {
            continue;
          }
          if (!root.contains(record.node)) {
            if (
              mergeAssertion &&
              (record.node === mergeAssertion.source ||
                mergeAssertion.source.contains(record.node))
            ) {
              continue;
            }
            if (
              mergeAssertion &&
              mergeAssertion.receiver.contains(record.parent) &&
              record.emptyInlineLink
            ) {
              continue;
            }
            if (
              [...equivalentReplacements].some((node) =>
                node.contains(record.node),
              )
            ) {
              continue;
            }
            const replacement = record.parent.childNodes[record.index];
            if (
              record.node instanceof Element &&
              replacement instanceof Element &&
              record.node.outerHTML === replacement.outerHTML
            ) {
              equivalentReplacements.add(record.node);
              continue;
            }
            const shape = (node: Node | undefined) =>
              !node
                ? "missing"
                : node instanceof Element
                  ? `${node.tagName}[text=${node.textContent?.length ?? 0};class=${node.getAttribute("class") ?? ""};style=${node.getAttribute("style") ?? ""}]`
                  : `${node.nodeName}[length=${node.textContent?.length ?? 0}]`;
            failures.push(
              `removed ${shape(record.node)} from ${path(record.parent)}[${record.index}], replacement=${shape(replacement)}, attributes=${record.attributeNames}, inline=${record.attributes}`,
            );
            continue;
          }
          const parent = record.parent === baseline.root ? root : record.parent;
          const moved = record.node.parentNode !== parent;
          const newParent = record.node.parentNode;
          const inlineWrapperRoot = (node: Node) => {
            let current: Node | null = node;
            while (
              current instanceof Element &&
              isEditorInlineStyleSpan(current)
            ) {
              current = current.parentNode;
            }
            return current;
          };
          const wrappedSiblingText =
            record.node instanceof Text &&
            newParent instanceof Element &&
            isEditorInlineStyleSpan(newParent) &&
            inlineWrapperRoot(newParent) === inlineWrapperRoot(parent);
          const promotedHeadingLine =
            operation.kind === "heading-enter" &&
            record.node instanceof HTMLElement &&
            record.node.tagName === "P" &&
            parent instanceof HTMLElement &&
            newParent instanceof HTMLElement &&
            root.contains(parent) &&
            newParent !== parent &&
            newParent.children.length === 2 &&
            newParent.firstElementChild?.tagName === "H2" &&
            newParent.lastElementChild === record.node;
          const expectedEmptyListMove =
            operation.kind === "empty-list-exit" &&
            record.node instanceof Element &&
            baseline.emptyListExit?.expectedMoves.includes(record.node) &&
            isListContainer(record.parent) &&
            record.node.parentNode &&
            isListContainer(record.node.parentNode);
          const expectedListMergeMove =
            record.node instanceof Element &&
            mergedListRows.has(record.node) &&
            record.node.parentNode === activeList;
          if (
            moved &&
            !(
              promotedHeadingLine ||
              wrappedSiblingText ||
              expectedListMergeMove ||
              (listShortcut &&
                record.node instanceof Element &&
                originalListRows.has(record.node) &&
                isListContainer(record.parent) &&
                record.node.parentNode &&
                isListContainer(record.node.parentNode)) ||
              expectedEmptyListMove
            )
          ) {
            const structure = (node: Node) =>
              node instanceof Element
                ? `${node.tagName}[${Array.from(node.children)
                    .map((child) => child.tagName)
                    .join(
                      ",",
                    )};list=${isListGroup(node)};text=${node.textContent?.length ?? 0}]`
                : node.nodeName;
            failures.push(
              `moved ${structure(record.node)} ${path(record.parent)}->${path(record.node.parentNode ?? record.parent)}`,
            );
          }
          const styleNode =
            record.node instanceof Text
              ? (record.node.parentElement ?? (parent as Element))
              : record.node;
          const attributes =
            record.node instanceof Element
              ? `${record.node.getAttribute("class") ?? ""}:${record.node.getAttribute("style") ?? ""}`
              : "";
          const changedStyle = changedStyleProperties(
            styleNode,
            record.styleValues,
          );
          const styleChanged = changedStyle.length > 0;
          const changes = styleChanged ? ["style"] : [];
          if (
            record.node instanceof Text &&
            record.node.data !== record.contentSignature
          )
            changes.push("text");
          if (
            record.node instanceof Element &&
            contentSignature(record.node) !== record.contentSignature
          )
            changes.push("text");
          if (
            record.node instanceof Element &&
            childShape(record.node) !== record.childShape
          )
            changes.push("child structure");
          if (
            record.node instanceof Element &&
            attributes !== record.attributes
          )
            changes.push("authored attributes");
          if (
            mergeAssertion &&
            (mergeAssertion.receiver === record.node ||
              mergeAssertion.receiver.contains(record.node))
          ) {
            const textIndex = changes.indexOf("text");
            if (textIndex >= 0) changes.splice(textIndex, 1);
            const structureIndex = changes.indexOf("child structure");
            if (structureIndex >= 0) changes.splice(structureIndex, 1);
          }
          if (
            record.node instanceof Element &&
            mergedListContainerContentChanges.has(record.node)
          ) {
            const textIndex = changes.indexOf("text");
            if (textIndex >= 0) changes.splice(textIndex, 1);
            const structureIndex = changes.indexOf("child structure");
            if (structureIndex >= 0) changes.splice(structureIndex, 1);
          }
          if (changes.length) {
            const changedTextLength =
              record.node instanceof Text
                ? record.node.data.length
                : contentSignature(record.node).length;
            const currentStyle = getComputedStyle(styleNode);
            const styleDetails = changedStyle.slice(0, 6).map((property) => {
              return `${property}=${record.styleValues[property] ?? ""}->${currentStyle.getPropertyValue(property)}`;
            });
            if (
              changedStyle.includes("transform-origin") &&
              !changedStyle.includes("transform")
            ) {
              styleDetails.push(
                `transform=${record.styleValues.transform}->${currentStyle.getPropertyValue("transform")}`,
              );
            }
            failures.push(
              `changed ${record.node.nodeName} at ${path(record.node)} (${changes.join(", ")}${changes.includes("text") ? `, content signature length=${record.contentSignature.length}->${changedTextLength}` : ""}${styleDetails.length ? `: ${styleDetails.join(", ")}` : ""})`,
            );
          }
        }
        if (baseline.emptyListExit && baseline.emptyListExit.list !== root) {
          const { list, listStyles, listAttributes } = baseline.emptyListExit;
          if (!root.contains(list)) {
            failures.push(
              "empty-list-exit removed its existing list container",
            );
          } else {
            const changed = changedStyleProperties(list, listStyles);
            if (changed.length) {
              failures.push(
                `empty-list-exit changed list container style: ${changed
                  .slice(0, 6)
                  .map(
                    (property) =>
                      `${property}=${listStyles[property] ?? ""}->${getComputedStyle(list).getPropertyValue(property)}`,
                  )
                  .join(", ")}`,
              );
            }
            if (authoredAttributes(list) !== listAttributes) {
              failures.push(
                "empty-list-exit changed list container attributes",
              );
            }
          }
        }
        if (mergeAssertion) {
          const action =
            mergeAssertion.direction === "backward" ? "Backspace" : "Delete";
          const normalizeText = (value: string) =>
            value.replaceAll(/[\u200b\ufeff]/g, "").replaceAll("\u00a0", " ");
          if (
            !root.contains(mergeAssertion.receiver) ||
            mergeAssertion.receiver.parentNode !== mergeAssertion.parent
          ) {
            failures.push(`block-edge ${action} moved its receiving block`);
          }
          if (root.contains(mergeAssertion.source)) {
            failures.push(
              `block-edge ${action} left the merged block in place`,
            );
          }
          const expectedText = normalizeText(
            mergeAssertion.receiverText + mergeAssertion.sourceText,
          );
          const actualText = normalizeText(
            mergeAssertion.receiver.textContent ?? "",
          );
          if (actualText !== expectedText) {
            failures.push(
              `block-edge ${mergeAssertion.direction === "backward" ? "Backspace" : "Delete"} changed the receiving text (${actualText.length} vs ${expectedText.length} characters; receiver=${normalizeText(mergeAssertion.receiverText).length}, source=${normalizeText(mergeAssertion.sourceText).length})`,
            );
          }
          const receiverFormatting = inlineFormatting(
            mergeAssertion.receiver,
            visibleText(mergeAssertion.receiverText).length,
            visibleText(mergeAssertion.receiverText).length +
              visibleText(mergeAssertion.sourceText).length,
          );
          if (
            JSON.stringify(receiverFormatting) !==
            JSON.stringify(mergeAssertion.sourceFormatting)
          ) {
            failures.push(
              `block-edge ${action} did not preserve source inline formatting (sourceRuns=${mergeAssertion.sourceFormatting.length}, mergedRuns=${receiverFormatting.length}, sourceMarks=${mergeAssertion.sourceFormatting.map(({ marks }) => marks.length).join(",")}, mergedMarks=${receiverFormatting.map(({ marks }) => marks.length).join(",")})`,
            );
          }
          const receiverPrefixFormatting = inlineFormatting(
            mergeAssertion.receiver,
            0,
            visibleText(mergeAssertion.receiverText).length,
          );
          if (
            JSON.stringify(receiverPrefixFormatting) !==
            JSON.stringify(mergeAssertion.receiverFormatting)
          ) {
            failures.push(
              `block-edge ${action} did not preserve receiver inline formatting (receiverRuns=${mergeAssertion.receiverFormatting.length}, mergedRuns=${receiverPrefixFormatting.length}, receiverMarks=${mergeAssertion.receiverFormatting.map(({ marks }) => marks.length).join(",")}, mergedMarks=${receiverPrefixFormatting.map(({ marks }) => marks.length).join(",")})`,
            );
          }
          const changedReceiverStyle = changedStyleProperties(
            mergeAssertion.receiver,
            mergeAssertion.receiverStyles,
          );
          if (
            authoredAttributes(mergeAssertion.receiver) !==
            mergeAssertion.receiverAttributes
          ) {
            failures.push(`block-edge ${action} changed receiver attributes`);
          }
          if (changedReceiverStyle.length) {
            failures.push(
              `block-edge ${action} changed receiver style (${changedReceiverStyle.slice(0, 6).join(", ")})`,
            );
          }
        }
        const expectedOrder = baseline.records
          .filter(
            (
              record,
            ): record is (typeof baseline.records)[number] & {
              node: Element;
              order: number;
            } =>
              record.node instanceof Element &&
              record.order !== undefined &&
              root.contains(record.node),
          )
          .sort((a, b) => a.order - b.order);
        const actualOrder = [...expectedOrder].sort((a, b) =>
          a.node.compareDocumentPosition(b.node) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
        if (
          expectedOrder.some(
            (record, index) => actualOrder[index]?.node !== record.node,
          )
        ) {
          failures.push("reordered sibling blocks");
        }
        return {
          failures: failures.length
            ? [...failures, `authoring targets: ${targetPaths}`]
            : failures,
          listIdentityChecks,
        };
      },
      {
        selector: editorSelector,
        phase,
        operation,
        requireMerge,
        listTag: authoringFuzzListTagForOperation(operation),
        styleProperties: AUTHORING_FUZZ_STYLE_PROPERTIES,
      },
    );
    return [
      ...result.failures,
      ...result.listIdentityChecks.flatMap(
        (check: { candidateId: string; resultId: string | null }) =>
          authoringFuzzPrecedingListMergePreservesIdentity(
            check.candidateId,
            check.resultId,
          )
            ? []
            : ["adjacent-list merge lost the preceding list's authored id"],
      ),
    ];
  };
  const assertOutsideUnchanged = async () => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const baseline = outsideBaseline;
    if (!baseline)
      throw new Error("outside-layout baseline is not initialized");
    const current = await snapshotOutside();
    const beforeScroll = slideScrollBaseline;
    const afterScroll = await slideScrollState();
    const changes = outsideAuthoringChangesFor(baseline, current);
    if (changes.length) {
      const scrollCandidates: Array<{ before: ScrollBox; after: ScrollBox }> = (
        afterScroll?.editorAncestors ?? []
      ).flatMap((after) => {
        const before = beforeScroll?.editorAncestors.find(
          (candidate) => candidate.key === after.key,
        );
        return before ? [{ before, after }] : [];
      });
      if (beforeScroll && afterScroll)
        scrollCandidates.push({ before: beforeScroll, after: afterScroll });
      const scrollSurface = scrollCandidates.find(
        (surface) =>
          surface &&
          surface.after.scrollHeight > surface.after.clientHeight &&
          surface.after.offsetHeight > 0 &&
          Math.abs(surface.after.scrollTop - surface.before.scrollTop) > 1 &&
          Math.abs(surface.after.rect.y - surface.before.rect.y) <= 1,
      );
      const scrollDelta = scrollSurface
        ? ((scrollSurface.after.scrollTop - scrollSurface.before.scrollTop) *
            scrollSurface.after.rect.height) /
          scrollSurface.after.offsetHeight
        : 0;
      const contentGrew =
        !!baseline.editedRect &&
        !!current.editedRect &&
        current.editedRect.height > baseline.editedRect.height + 1 &&
        baseline.editedInFlow === true &&
        current.editedInFlow === true;
      const containerOverflows = !!scrollSurface;
      const fitPositionStylesUnchanged =
        !!beforeScroll?.fit &&
        !!afterScroll?.fit &&
        [
          "transform",
          "transformOrigin",
          "top",
          "left",
          "right",
          "bottom",
          "position",
          "marginTop",
          "marginBottom",
          "alignSelf",
          "fitScale",
          "fitX",
          "fitY",
        ].every(
          (property) =>
            beforeScroll.fit?.[property as keyof typeof beforeScroll.fit] ===
            afterScroll.fit?.[property as keyof typeof afterScroll.fit],
        );
      const fitSizeUnchanged =
        !!beforeScroll?.fit &&
        !!afterScroll?.fit &&
        Math.abs(beforeScroll.fit.width - afterScroll.fit.width) <= 1 &&
        Math.abs(beforeScroll.fit.height - afterScroll.fit.height) <= 1;
      const stationary =
        scrollSurface &&
        ["x", "y", "width", "height"].every(
          (property) =>
            Math.abs(
              scrollSurface.before.rect[
                property as keyof typeof scrollSurface.before.rect
              ] -
                scrollSurface.after.rect[
                  property as keyof typeof scrollSurface.after.rect
                ],
            ) <= 1,
        );
      if (
        isCaretScrollOnlyChange(changes, {
          scrollDelta,
          contentGrew,
          containerOverflows,
          containerStationary: stationary === true,
          fitPositionStylesUnchanged,
          fitSizeUnchanged,
        })
      ) {
        outsideBaseline = current;
        slideScrollBaseline = afterScroll;
        return;
      }
      const scrollSummary = (state: SlideScrollState | null) =>
        state && {
          canvas: state.canvasRect,
          slide: [state.scrollTop, state.scrollHeight, state.documentScrollTop],
          editorAncestors: state.editorAncestors.map((ancestor) => [
            ancestor.key,
            ancestor.scrollTop,
            ancestor.scrollHeight,
            ancestor.clientHeight,
            ancestor.rect,
          ]),
          ancestors: state.scrollAncestors.map((ancestor) => [
            ancestor.scrollTop,
            (ancestor.rect as { y: number }).y,
          ]),
          fitLayers: state.fitLayers.map((layer) => [
            layer.className,
            layer.autofitContent,
            layer.autofitActive,
            layer.rect.y,
            layer.transform,
            layer.fitY,
            layer.parentY,
          ]),
        };
      const summarizeRecord = (record: OutsideSnapshot["records"][number]) => {
        const props = [
          "display",
          "position",
          "transform",
          "translate",
          "rotate",
          "scale",
          "margin-top",
          "align-items",
          "justify-content",
          "flex-direction",
          "--fmd-fit-y",
          "data-fmd-autofit-active",
        ];
        return {
          stableKey: record.stableKey,
          className: record.className,
          rect: record.rect,
          props: Object.fromEntries(
            props.map((property) => [property, record.props[property]]),
          ),
          layout: record.layoutPath?.slice(0, 2),
        };
      };
      const changedRecords = changes
        .slice(0, 3)
        .map(({ key }) => ({
          key,
          before: baseline.records.find((record) => record.key === key),
          after: current.records.find((record) => record.key === key),
        }))
        .map(({ key, before, after }) => ({
          key,
          before: before && summarizeRecord(before),
          after: after && summarizeRecord(after),
        }));
      throw new Error(
        `unexpected changes outside the edited element: ${JSON.stringify(changes.slice(0, 5))}; records=${JSON.stringify(changedRecords)}; caret-scroll evidence=${JSON.stringify({ before: scrollSummary(beforeScroll), after: scrollSummary(afterScroll), editedRects: [baseline.editedRect, current.editedRect], scrollDelta, contentGrew, containerOverflows, containerStationary: stationary === true, fitPositionStylesUnchanged, fitSizeUnchanged })}`,
      );
    }
    outsideBaseline = current;
    slideScrollBaseline = afterScroll;
  };
  const withoutSessionAttributes = async (html: string) =>
    page.evaluate((value: string) => {
      const template = document.createElement("template");
      template.innerHTML = value;
      for (const element of template.content.querySelectorAll<HTMLElement>(
        '[contenteditable="true"][data-editing-block="true"]',
      )) {
        element.removeAttribute("contenteditable");
        element.removeAttribute("data-editing-block");
      }
      return template.innerHTML;
    }, html);
  const shortcutResultCount = async (result: string) =>
    editor.evaluate((root: HTMLElement, expected: string) => {
      const count = (selector: string) =>
        root.querySelectorAll(selector).length +
        (root.matches(selector) ? 1 : 0);
      if (expected.startsWith("heading")) {
        const level = expected.slice(-1);
        return count(`h${level}`);
      }
      switch (expected) {
        case "bullet": {
          const rows = [
            ...(root.matches("div") ? [root] : []),
            ...Array.from(root.querySelectorAll<HTMLElement>("div")),
          ];
          const styledRows = rows.filter((row) => {
            const marker = row.firstElementChild;
            const text = row.lastElementChild;
            return (
              getComputedStyle(row).display === "flex" &&
              marker?.tagName === "SPAN" &&
              /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
              text?.tagName === "SPAN"
            );
          });
          return count("ul > li") + styledRows.length;
        }
        case "ordered":
          return count("ol > li");
        case "quote":
          return count("blockquote");
        case "divider":
          return count("hr");
        case "bold":
          return count("strong, b, span[style*='font-weight']");
        case "italic":
          return count("em, i, span[style*='font-style']");
        case "strike":
          return count("s, del, span[style*='text-decoration']");
        case "code":
          return count("code");
        default:
          return 0;
      }
    }, result);
  const inlineShortcutText = (result: string, value: string) => {
    if (result === "bold" || result === "strike") return value.slice(2, -2);
    if (result === "italic" || result === "code") return value.slice(1, -1);
    return null;
  };
  const inlineShortcutIsActive = async (
    format: string,
    value: string,
    expectedTextLength: number,
  ) =>
    editor.evaluate(
      (
        root: HTMLElement,
        expected: { format: string; text: string; textLength: number },
      ) => {
        const selection = window.getSelection();
        const anchor =
          selection?.anchorNode instanceof HTMLElement
            ? selection.anchorNode
            : selection?.anchorNode?.parentElement;
        const block =
          anchor?.closest<HTMLElement>(
            "p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,div",
          ) ?? root;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          nodes.push(node as Text);
        }
        const text = nodes.map((node) => node.data).join("");
        if (text.length !== expected.textLength) return false;
        const tokenStart = text.length - expected.text.length;
        if (tokenStart < 0 || !text.endsWith(expected.text)) return false;

        const hasFormat = (node: Text) => {
          for (
            let element = node.parentElement;
            element && root.contains(element);
            element = element.parentElement
          ) {
            const style = window.getComputedStyle(element);
            if (expected.format === "bold") {
              const weight = style.fontWeight;
              if (
                element.tagName === "B" ||
                element.tagName === "STRONG" ||
                weight === "bold" ||
                (Number.parseFloat(weight) || 0) >= 600
              ) {
                return true;
              }
            } else if (expected.format === "italic") {
              if (
                element.tagName === "I" ||
                element.tagName === "EM" ||
                style.fontStyle === "italic" ||
                style.fontStyle === "oblique"
              ) {
                return true;
              }
            } else if (expected.format === "strike") {
              if (
                element.tagName === "S" ||
                element.tagName === "DEL" ||
                style.textDecorationLine.includes("line-through") ||
                style.textDecoration.includes("line-through")
              ) {
                return true;
              }
            } else if (element.tagName === "CODE") {
              return true;
            }
            if (element === block) break;
          }
          return false;
        };

        let offset = 0;
        let checked = 0;
        for (const node of nodes) {
          const end = offset + node.data.length;
          if (end > tokenStart && offset < text.length) {
            if (!hasFormat(node)) return false;
            checked +=
              Math.min(end, text.length) - Math.max(offset, tokenStart);
          }
          offset = end;
        }
        return checked === expected.text.length;
      },
      { format, text: value, textLength: expectedTextLength },
    );
  const shortcutState = async () =>
    editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = element?.closest<HTMLElement>(
        "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
      );
      const shape = (node: Element, depth: number): unknown => {
        const text = node.textContent ?? "";
        return {
          tag: node.tagName,
          textLength: text.length,
          isDashSpace: text.replaceAll("\u00a0", " ") === "- ",
          isDashNbsp: text === "-\u00a0",
          children:
            depth > 0
              ? Array.from(node.childNodes)
                  .slice(-8)
                  .map((child) =>
                    child instanceof Text
                      ? {
                          kind: "text",
                          length: child.data.length,
                          isDash: child.data === "-",
                          isDashSpace:
                            child.data.replaceAll("\u00a0", " ") === "- ",
                          endsWithDash: child.data.endsWith("-"),
                          endsWithSpace: /[\u0020\u00a0]$/.test(child.data),
                        }
                      : shape(child as Element, depth - 1),
                  )
              : undefined,
        };
      };
      const blockText = (block?.textContent ?? "")
        .replaceAll("\u200b", "")
        .replaceAll("\u00a0", " ");
      return {
        focused: document.activeElement === root,
        caretInside: !!anchor && root.contains(anchor),
        collapsed: selection?.isCollapsed ?? false,
        blockTag: block?.tagName ?? null,
        blockTextLength: blockText.length,
        blockIsDashSpace: blockText === "- ",
        blockEndsWithDashSpace: blockText.endsWith("- "),
        blockEndsWithDash: blockText.endsWith("-"),
        blockEndsWithSpace: /[ \u00a0]$/.test(block?.textContent ?? ""),
        block: block ? shape(block, 2) : null,
      };
    });
  const assertShortcut = async (
    result: string,
    before: number,
    value: string,
    beforeTrigger: Awaited<ReturnType<typeof shortcutState>>,
  ) => {
    const after = await shortcutResultCount(result);
    const content = inlineShortcutText(result, value);
    const produced =
      content === null
        ? after > before
        : await inlineShortcutIsActive(
            result,
            content,
            beforeTrigger.blockTextLength - (value.length - 1 - content.length),
          );
    if (!produced) {
      const state = await shortcutState();
      throw new Error(
        `markdown shortcut did not produce ${result} (${before} -> ${after}; before trigger=${JSON.stringify(beforeTrigger)}; after=${JSON.stringify(state)})`,
      );
    }
  };
  const newLine = async () => newPlainLine();
  const plainLineState = async () =>
    editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = element?.closest<HTMLElement>(
        "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
      );
      const current = block ?? root;
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      let lineStart: [Node, number] = [current, 0];
      if (range) {
        for (const br of Array.from(current.querySelectorAll("br"))) {
          const parent = br.parentNode;
          if (!parent) continue;
          const breakEnd = document.createRange();
          breakEnd.setStart(
            parent,
            Array.from(parent.childNodes).indexOf(br) + 1,
          );
          breakEnd.collapse(true);
          if (
            range.compareBoundaryPoints(Range.START_TO_START, breakEnd) >= 0
          ) {
            lineStart = [breakEnd.startContainer, breakEnd.startOffset];
          }
        }
      }
      const prefix = document.createRange();
      prefix.setStart(...lineStart);
      if (range) prefix.setEnd(range.startContainer, range.startOffset);
      const suffix = document.createRange();
      if (range) {
        suffix.setStart(range.startContainer, range.startOffset);
        suffix.setEnd(current, current.childNodes.length);
      }
      const hasContent = (fragment: DocumentFragment) =>
        !!fragment.textContent
          ?.replaceAll("\u200b", "")
          .replaceAll("\ufeff", "")
          .replaceAll("\u00a0", "") ||
        fragment.querySelector(
          "img,svg,video,canvas,picture,iframe,input,hr",
        ) !== null;
      const isStyledListRow = (candidate: HTMLElement) => {
        const marker = candidate.firstElementChild;
        return (
          getComputedStyle(candidate).display === "flex" &&
          marker?.tagName === "SPAN" &&
          /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
          candidate.lastElementChild?.tagName === "SPAN"
        );
      };
      let inStyledListRow = false;
      for (
        let ancestor = element;
        ancestor && root.contains(ancestor);
        ancestor = ancestor.parentElement
      ) {
        if (isStyledListRow(ancestor)) {
          inStyledListRow = true;
          break;
        }
        if (ancestor === root) break;
      }
      return {
        valid:
          !!selection &&
          selection.isCollapsed &&
          !!anchor &&
          root.contains(anchor) &&
          (current.tagName === "P" || current.tagName === "DIV") &&
          !current.closest("li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre") &&
          !element?.closest("li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre") &&
          !inStyledListRow &&
          !!range &&
          !hasContent(prefix.cloneContents()) &&
          !hasContent(suffix.cloneContents()),
        tag: current.tagName,
        linePrefixLength: prefix.toString().length,
        lineSuffixLength: suffix.toString().length,
        focused: document.activeElement === root,
        anchorTag:
          anchor instanceof Element
            ? anchor.tagName
            : anchor?.parentElement?.tagName,
        anchorOffset: selection?.anchorOffset ?? null,
        blockedContext: !!element?.closest(
          "li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre",
        ),
        ancestorTags: (() => {
          const tags: string[] = [];
          for (
            let current = element;
            current && root.contains(current);
            current = current.parentElement
          ) {
            tags.push(current.tagName);
            if (current === root) break;
          }
          return tags;
        })(),
      };
    });
  const newPlainLine = async (label = "authoring operation") => {
    await editor.evaluate((root: HTMLElement) => {
      if (document.activeElement !== root) root.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("editor has no text selection");
      const isVisible = (range: Range) => {
        const rangeRect = range.getBoundingClientRect();
        const anchor =
          range.startContainer instanceof Element
            ? range.startContainer
            : range.startContainer.parentElement;
        const rect =
          rangeRect.height > 0 ? rangeRect : anchor?.getBoundingClientRect();
        return (
          !!rect &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight
        );
      };
      const blockEdgeRange = (block: HTMLElement, end: boolean) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let firstText: Text | null = null;
        let lastText: Text | null = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          if (!text.length) continue;
          firstText ??= text;
          lastText = text;
        }
        const range = document.createRange();
        const text = end ? lastText : firstText;
        if (text) range.setStart(text, end ? text.length : 0);
        else range.selectNodeContents(block);
        range.collapse(end);
        return range;
      };
      let emptyPlainRange: Range | null = null;
      let plainEndRange: Range | null = null;
      let plainStartRange: Range | null = null;
      const plainBlocks = [
        ...(root.matches("p,div") ? [root] : []),
        ...root.querySelectorAll<HTMLElement>("p,div"),
      ];
      for (const block of plainBlocks) {
        if (
          block.querySelector("p,div,li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre")
        )
          continue;
        if (block.closest("li,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre"))
          continue;
        const marker = block.firstElementChild;
        if (
          getComputedStyle(block).display === "flex" &&
          marker?.tagName === "SPAN" &&
          /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
          block.lastElementChild?.tagName === "SPAN"
        )
          continue;
        if (block.querySelector("img,svg,video,canvas,picture,iframe,input,hr"))
          continue;
        const text = (block.textContent ?? "")
          .replaceAll(/[\u200b\ufeff]/g, "")
          .replaceAll("\u00a0", "");
        const endRange = blockEdgeRange(block, true);
        if (isVisible(endRange)) {
          if (!text) {
            emptyPlainRange = endRange;
            break;
          }
          plainEndRange ??= endRange;
          continue;
        }
        if (!text) continue;
        const startRange = blockEdgeRange(block, false);
        if (isVisible(startRange)) plainStartRange ??= startRange;
      }
      let range = emptyPlainRange ?? plainEndRange ?? plainStartRange;
      if (!range) {
        const headings = [
          ...(root.matches("h1,h2,h3,h4,h5,h6") ? [root] : []),
          ...root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
        ];
        for (const heading of headings) {
          const candidate = blockEdgeRange(heading, true);
          if (isVisible(candidate)) {
            range = candidate;
            break;
          }
        }
      }
      if (!range) {
        const textBlocks = Array.from(
          root.querySelectorAll<HTMLElement>(
            "li,blockquote,pre,h1,h2,h3,h4,h5,h6,ol,ul",
          ),
        ).reverse();
        for (const block of textBlocks) {
          const candidate = blockEdgeRange(block, true);
          if (isVisible(candidate)) {
            range = candidate;
            break;
          }
        }
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
      const caretTarget = range.startContainer.parentElement ?? root;
      caretTarget.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
      const rangeRect = range.getBoundingClientRect();
      const caretRect =
        rangeRect.height > 0
          ? rangeRect
          : range.startContainer instanceof Element
            ? range.startContainer.getBoundingClientRect()
            : range.startContainer.parentElement?.getBoundingClientRect();
      if (
        !caretRect ||
        caretRect.height <= 0 ||
        caretRect.left < 0 ||
        caretRect.left > window.innerWidth ||
        caretRect.top < 0 ||
        caretRect.bottom > window.innerHeight
      ) {
        throw new Error("authoring fuzz could not place its caret in view");
      }
    });
    let state = await plainLineState();
    const setupStates = [state];
    let attempts = 0;
    for (let attempt = 0; !state.valid && attempt < 8; attempt += 1) {
      await page.keyboard.press("Enter");
      await editor.evaluate((root: HTMLElement) => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!root.contains(range.startContainer)) return;
        const caretTarget = range.startContainer.parentElement ?? root;
        caretTarget.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      });
      state = await plainLineState();
      setupStates.push(state);
      attempts += 1;
    }
    if (!state.valid)
      throw new Error(
        `${label} setup did not reach an empty plain line (${JSON.stringify({ attempts, state, setupStates })})`,
      );
    const finalCaret = await editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !root.contains(selection.focusNode))
        return null;
      const range = selection.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      const anchor =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const rect =
        rangeRect.height > 0 ? rangeRect : anchor?.getBoundingClientRect();
      if (!rect) return null;
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        withinViewport:
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.left <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight,
      };
    });
    if (!finalCaret?.withinViewport)
      throw new Error(
        `${label} setup left the caret outside the viewport (${JSON.stringify(finalCaret)})`,
      );
    const operation = plan[activeIndex];
    if (!operation) throw new Error("authoring operation is unavailable");
    await snapshotEditorSiblings("capture", operation);
  };
  const openSlashMenu = async () => {
    tracePhase("slash.new-line:start");
    await newLine();
    tracePhase("slash.new-line:end");
    tracePhase("slash.type:start");
    await typeText("/");
    tracePhase("slash.type:end");
    const listbox = await waitForControlledSlashListbox();
    const options = listbox.locator('[role="option"]');
    tracePhase("slash.wait-visible:start");
    await options.first().waitFor({ state: "visible", timeout: 5_000 });
    tracePhase("slash.wait-visible:end");
    if ((await options.count()) !== SLASH_COMMANDS.length)
      throw new Error("slash menu did not expose all eight commands");
    const initialOptionId = await editor.getAttribute("aria-activedescendant");
    const initialCommand = initialOptionId
      ? await page
          .locator(`[id=${JSON.stringify(initialOptionId)}]`)
          .getAttribute("data-value")
      : null;
    await options.nth(1).hover();
    if (!slashHoverThemesChecked) {
      const originalTheme = await page.evaluate(() => ({
        light: document.documentElement.classList.contains("light"),
        dark: document.documentElement.classList.contains("dark"),
      }));
      try {
        for (const theme of ["light", "dark"] as const) {
          await page.evaluate((nextTheme: "light" | "dark") => {
            const root = document.documentElement;
            root.classList.toggle("light", nextTheme === "light");
            root.classList.toggle("dark", nextTheme === "dark");
          }, theme);
          const hoverState = await editor.evaluate((root: HTMLElement) => {
            const activeId = root.getAttribute("aria-activedescendant");
            const activeOption = activeId
              ? document.getElementById(activeId)
              : null;
            const hoveredOption = document.querySelector<HTMLElement>(
              '[role="option"]:hover',
            );
            const activeBackground = activeOption
              ? getComputedStyle(activeOption).backgroundColor
              : null;
            const hoveredBackground = hoveredOption
              ? getComputedStyle(hoveredOption).backgroundColor
              : null;
            const surfaceBackgrounds: string[] = [];
            for (
              let ancestor = hoveredOption?.parentElement ?? null;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              surfaceBackgrounds.push(
                getComputedStyle(ancestor).backgroundColor,
              );
            }
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext("2d", {
              willReadFrequently: true,
            });
            const renderOverSurface = (foreground: string | null) => {
              if (
                !context ||
                !foreground ||
                !CSS.supports("color", foreground) ||
                surfaceBackgrounds.some(
                  (background) => !CSS.supports("color", background),
                )
              ) {
                return null;
              }
              context.clearRect(0, 0, 1, 1);
              for (const background of [...surfaceBackgrounds].reverse()) {
                context.fillStyle = background;
                context.fillRect(0, 0, 1, 1);
              }
              context.fillStyle = foreground;
              context.fillRect(0, 0, 1, 1);
              const { data } = context.getImageData(0, 0, 1, 1);
              return [data[0], data[1], data[2]] as [number, number, number];
            };
            const activeRendered = renderOverSurface(activeBackground);
            const hoveredRendered = renderOverSurface(hoveredBackground);
            return {
              focused: document.activeElement === root,
              activeCommand: activeOption?.getAttribute("data-value") ?? null,
              hoveredCommand: hoveredOption?.getAttribute("data-value") ?? null,
              activeBackground,
              hoveredBackground,
              surfaceBackgrounds,
              backgroundDifference:
                activeRendered && hoveredRendered
                  ? Math.max(
                      ...activeRendered.map((channel, index) =>
                        Math.abs(channel - hoveredRendered[index]),
                      ),
                    )
                  : null,
            };
          });
          if (
            !initialCommand ||
            !hoverState.focused ||
            hoverState.activeCommand !== initialCommand ||
            !hoverState.hoveredCommand ||
            hoverState.hoveredCommand === initialCommand ||
            !hoverState.activeBackground ||
            !hoverState.hoveredBackground ||
            hoverState.backgroundDifference === null ||
            hoverState.backgroundDifference < 24
          ) {
            throw new Error(
              `slash menu hover changed or lacks clear contrast from keyboard selection in ${theme} theme (${JSON.stringify({ initialCommand, hoverState })})`,
            );
          }
        }
      } finally {
        await page.evaluate(
          ({ light, dark }: { light: boolean; dark: boolean }) => {
            const root = document.documentElement;
            root.classList.toggle("light", light);
            root.classList.toggle("dark", dark);
          },
          originalTheme,
        );
      }
      slashHoverThemesChecked = true;
    }
    const focused = await editor.evaluate(
      (root: HTMLElement) => document.activeElement === root,
    );
    if (!focused) throw new Error("slash menu stole focus from the editor");
    const position = await listbox.evaluate((menu: HTMLElement) => {
      const bounds = (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      const rect = menu.getBoundingClientRect();
      const anchor = window
        .getSelection()
        ?.getRangeAt(0)
        .getBoundingClientRect();
      return {
        menu: bounds(rect),
        anchor: anchor ? bounds(anchor) : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        anchorInViewport:
          !!anchor &&
          anchor.right >= 0 &&
          anchor.left <= window.innerWidth &&
          anchor.bottom >= 0 &&
          anchor.top <= window.innerHeight,
        side: menu.getAttribute("data-side"),
        within:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight,
      };
    });
    if (!position.within && position.anchorInViewport)
      throw new Error(
        `slash menu is clipped beyond the viewport (${JSON.stringify(position)})`,
      );
    return listbox;
  };
  const waitForControlledSlashListbox = async () => {
    try {
      await page.waitForFunction(
        (selector: string) => {
          const editingEl = document.querySelector<HTMLElement>(selector);
          const listboxId = editingEl?.getAttribute("aria-controls");
          const optionId = editingEl?.getAttribute("aria-activedescendant");
          const listbox = listboxId ? document.getElementById(listboxId) : null;
          const activeOption = optionId
            ? document.getElementById(optionId)
            : null;
          return (
            listbox?.getAttribute("role") === "listbox" &&
            activeOption?.getAttribute("role") === "option" &&
            listbox.contains(activeOption)
          );
        },
        editorSelector,
        { timeout: 5000 },
      );
    } catch (error) {
      const state = await editor.evaluate((root: HTMLElement) => {
        const listboxId = root.getAttribute("aria-controls");
        const activeId = root.getAttribute("aria-activedescendant");
        const listbox = listboxId ? document.getElementById(listboxId) : null;
        const activeOption = activeId
          ? document.getElementById(activeId)
          : null;
        return {
          focused: document.activeElement === root,
          controls: listboxId,
          activeDescendant: activeId,
          listboxRole: listbox?.getAttribute("role") ?? null,
          activeRole: activeOption?.getAttribute("role") ?? null,
          activeValue: activeOption?.getAttribute("data-value") ?? null,
          contained:
            !!listbox && !!activeOption && listbox.contains(activeOption),
          listboxes: document.querySelectorAll('[role="listbox"]').length,
          options: document.querySelectorAll('[role="option"]').length,
        };
      });
      throw new Error(
        `slash menu did not expose a controlled active option (${JSON.stringify(state)}); ${String(error)}`,
      );
    }
    const listboxId = await editor.getAttribute("aria-controls");
    if (!listboxId) throw new Error("slash menu did not expose its listbox");
    return page.locator(`[role="listbox"][id=${JSON.stringify(listboxId)}]`);
  };
  const slashListboxId = async (listbox: Locator) => {
    const listboxId = await listbox.getAttribute("id");
    if (!listboxId) throw new Error("slash menu did not expose its listbox id");
    return listboxId;
  };
  const waitForSlashMenuHidden = async (listboxId: string) => {
    const state = () =>
      page.evaluate(
        ({ selector, id }: { selector: string; id: string }) => {
          const editor = document.querySelector<HTMLElement>(selector);
          const menu = document.getElementById(id);
          const style = menu ? window.getComputedStyle(menu) : null;
          return {
            controlled: editor?.getAttribute("aria-controls") === id,
            expanded: editor?.getAttribute("aria-expanded") === "true",
            exists: !!menu,
            visible:
              !!menu &&
              !!style &&
              !menu.hidden &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              menu.getClientRects().length > 0,
          };
        },
        { selector: editorSelector, id: listboxId },
      );
    try {
      const closed = await page.evaluate(
        ({ selector, id }: { selector: string; id: string }) =>
          new Promise<boolean>((resolve) => {
            let observer: MutationObserver | undefined;
            let timer: number | undefined;
            const finish = (isClosed: boolean) => {
              observer?.disconnect();
              if (timer !== undefined) window.clearTimeout(timer);
              resolve(isClosed);
            };
            const isClosed = () => {
              const editor = document.querySelector<HTMLElement>(selector);
              const menu = document.getElementById(id);
              const style = menu ? window.getComputedStyle(menu) : null;
              const visible =
                !!menu &&
                !!style &&
                !menu.hidden &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                menu.getClientRects().length > 0;
              return editor?.getAttribute("aria-controls") !== id && !visible;
            };
            observer = new MutationObserver(() => {
              if (isClosed()) finish(true);
            });
            observer.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: [
                "aria-controls",
                "aria-expanded",
                "aria-hidden",
                "class",
                "data-state",
                "hidden",
                "id",
                "role",
                "style",
              ],
            });
            timer = window.setTimeout(() => finish(isClosed()), 1500);
            if (isClosed()) finish(true);
          }),
        { selector: editorSelector, id: listboxId },
      );
      if (!closed) throw new Error("timeout 1500ms exceeded");
    } catch (error) {
      const closeState = await state();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `slash menu did not close (${reason}); state=${JSON.stringify(closeState)}`,
      );
    }
  };
  const assertSlashMenuStaysHidden = async () => {
    const menuOpened = await page.evaluate(
      ({ selector, durationMs }: { selector: string; durationMs: number }) => {
        const editingEl = document.querySelector<HTMLElement>(selector);
        if (!editingEl) throw new Error("slash menu editor is unavailable");
        const isVisibleListbox = (listbox: HTMLElement) => {
          const style = getComputedStyle(listbox);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            listbox.getClientRects().length > 0
          );
        };
        const hasVisibleListbox = () =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[role="listbox"]'),
          ).some(isVisibleListbox);
        return new Promise<boolean>((resolve) => {
          let observer: MutationObserver | undefined;
          let timer: number | undefined;
          const finish = (opened: boolean) => {
            observer?.disconnect();
            if (timer !== undefined) window.clearTimeout(timer);
            resolve(opened);
          };
          const check = () => {
            if (hasVisibleListbox()) finish(true);
          };
          observer = new MutationObserver(check);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [
              "aria-activedescendant",
              "aria-controls",
              "aria-hidden",
              "class",
              "data-state",
              "hidden",
              "id",
              "role",
              "style",
            ],
          });
          timer = window.setTimeout(() => finish(false), durationMs);
          check();
        });
      },
      { selector: editorSelector, durationMs: 1_500 },
    );
    if (menuOpened)
      throw new Error("slash menu opened for a slash within text or a URL");
  };
  const runSlashCommand = async (
    command: string,
    key: "Enter" | "Tab" = "Enter",
  ) => {
    const listbox = await openSlashMenu();
    const currentOptionId = await editor.getAttribute("aria-activedescendant");
    const activeCommand = await listbox
      .locator('[role="option"]')
      .evaluateAll(
        (options: Element[], activeId: string | null) =>
          options
            .find((option) => option.getAttribute("id") === activeId)
            ?.getAttribute("data-value") ?? null,
        currentOptionId,
      );
    const arrowDownCount = authoringFuzzSlashArrowDownCount(
      activeCommand,
      command,
    );
    tracePhase(`slash.navigate:start:${command}`);
    let selectedIndex = SLASH_COMMANDS.findIndex(
      ([value]) => value === activeCommand,
    );
    await page.evaluate((selector: string) => {
      const trace: Array<{
        keyCode: number;
        isComposing: boolean;
        activeBefore: string | null;
        defaultPreventedAfter?: boolean;
        activeAfter?: string | null;
      }> = [];
      const listener = (event: KeyboardEvent) => {
        if (event.key !== "ArrowDown") return;
        const editingEl = document.querySelector<HTMLElement>(selector);
        if (!editingEl) return;
        const activeValue = () => {
          const id = editingEl.getAttribute("aria-activedescendant");
          return id
            ? (document.getElementById(id)?.getAttribute("data-value") ?? null)
            : null;
        };
        const entry: {
          keyCode: number;
          isComposing: boolean;
          activeBefore: string | null;
          defaultPreventedAfter?: boolean;
          activeAfter?: string | null;
        } = {
          keyCode: event.keyCode,
          isComposing: event.isComposing,
          activeBefore: activeValue(),
        };
        trace.push(entry);
        requestAnimationFrame(() => {
          entry.defaultPreventedAfter = event.defaultPrevented;
          entry.activeAfter = activeValue();
        });
      };
      document.addEventListener("keydown", listener, true);
      (
        window as Window & {
          __slidesSlashNavigationTrace?: {
            trace: typeof trace;
            listener: typeof listener;
          };
        }
      ).__slidesSlashNavigationTrace = { trace, listener };
    }, editorSelector);
    try {
      for (let index = 0; index < arrowDownCount; index += 1) {
        selectedIndex = (selectedIndex + 1) % SLASH_COMMANDS.length;
        const expectedCommand = SLASH_COMMANDS[selectedIndex][0];
        await page.keyboard.press("ArrowDown");
        try {
          await page.waitForFunction(
            ({ selector, value }: { selector: string; value: string }) => {
              const editingEl = document.querySelector<HTMLElement>(selector);
              const activeId = editingEl?.getAttribute("aria-activedescendant");
              const activeOption = activeId
                ? document.getElementById(activeId)
                : null;
              return activeOption?.getAttribute("data-value") === value;
            },
            { selector: editorSelector, value: expectedCommand },
            { timeout: 5000 },
          );
        } catch (error) {
          const navigationState = await page.evaluate((selector: string) => {
            const editingEl = document.querySelector<HTMLElement>(selector);
            const activeId = editingEl?.getAttribute("aria-activedescendant");
            const activeOption = activeId
              ? document.getElementById(activeId)
              : null;
            const traceOwner = window as Window & {
              __slidesSlashNavigationTrace?: {
                trace: Array<Record<string, unknown>>;
              };
            };
            return {
              current: activeOption?.getAttribute("data-value") ?? null,
              trace: traceOwner.__slidesSlashNavigationTrace?.trace ?? [],
            };
          }, editorSelector);
          throw new Error(
            `slash navigation to ${command} from ${activeCommand} stalled at ${index + 1}/${arrowDownCount}; expected ${expectedCommand}, current ${navigationState.current}, key trace=${JSON.stringify(navigationState.trace.slice(-8))}; ${String(error)}`,
          );
        }
      }
    } finally {
      await page.evaluate(() => {
        const traceOwner = window as Window & {
          __slidesSlashNavigationTrace?: {
            trace: unknown[];
            listener: EventListener;
          };
        };
        const trace = traceOwner.__slidesSlashNavigationTrace;
        if (trace)
          document.removeEventListener("keydown", trace.listener, true);
        delete traceOwner.__slidesSlashNavigationTrace;
      });
    }
    const activeOptionId = await listbox
      .locator(`[role="option"][data-value="${command}"]`)
      .getAttribute("id");
    const selectedCommand = await listbox
      .locator('[role="option"][aria-selected="true"]')
      .getAttribute("data-value");
    if (
      !activeOptionId ||
      (await editor.getAttribute("aria-activedescendant")) !== activeOptionId
    ) {
      throw new Error(
        `slash menu did not select ${command} (started at ${activeCommand}, moved ${arrowDownCount}, selected ${selectedCommand ?? "none"})`,
      );
    }
    const withTrigger = await inspectSelection();
    const listboxId = await slashListboxId(listbox);
    tracePhase(`slash.command-key:start:${command}:${key}`);
    await page.keyboard.press(key);
    tracePhase(`slash.command-key:end:${command}:${key}`);
    tracePhase(`slash.wait-hidden:start:${command}`);
    await waitForSlashMenuHidden(listboxId);
    tracePhase(`slash.wait-hidden:end:${command}`);
    if (
      slashCount((await inspectSelection()).text) !==
      slashCount(withTrigger.text) - 1
    )
      throw new Error(`${command} did not consume its slash query`);
  };
  const prepareParagraphPair = async (label: string) => {
    await newPlainLine(label);
    const headingCommand = await editor.evaluate((root: HTMLElement) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const element =
        anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      const block = element?.closest<HTMLElement>(
        "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
      );
      return block?.tagName === "H2" ? "heading3" : "heading2";
    });
    await runSlashCommand(headingCommand);
    await editor.press(lineEndKey);
    await editor.press("Enter");
    if (!(await plainLineState()).valid) {
      throw new Error(
        `${label} setup did not create a paragraph after a heading`,
      );
    }
  };
  const selectToken = async (token: string, edge?: "start" | "end") =>
    editor.evaluate(
      (
        root: HTMLElement,
        target: { token: string; edge?: "start" | "end" },
      ) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const points: Array<{ text: Text; offset: number }> = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (text.data[offset] !== "\u200b") {
              points.push({ text, offset });
            }
          }
        }
        const visible = points
          .map(({ text, offset }) =>
            text.data[offset] === "\u00a0" ? " " : text.data[offset],
          )
          .join("");
        const index = visible.lastIndexOf(target.token);
        if (index < 0) throw new Error("could not locate fuzz token");
        const start = points[index]!;
        const last = points[index + target.token.length - 1]!;
        const selected = document.createRange();
        if (target.edge === "end") {
          selected.setStart(last.text, last.offset + 1);
          selected.collapse(true);
        } else {
          selected.setStart(start.text, start.offset);
          if (target.edge === "start") selected.collapse(true);
          else selected.setEnd(last.text, last.offset + 1);
        }
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
        selection.removeAllRanges();
        selection.addRange(selected);
      },
      { token, edge },
    );
  const placeCaretAtToken = async (token: string, edge: "start" | "end") => {
    await selectToken(token, edge);
  };
  const listCaretState = async (token: string) =>
    editor.evaluate((root: HTMLElement, value: string) => {
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const anchor =
        anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
      const activeItem = anchor?.closest<HTMLElement>("li") ?? null;
      const tokenItem =
        Array.from(root.querySelectorAll<HTMLElement>("li")).find((item) =>
          item.textContent?.includes(value),
        ) ?? null;
      const itemState = (item: HTMLElement | null) =>
        item
          ? {
              connected: item.isConnected,
              parentTag: item.parentElement?.tagName ?? null,
              textLength: item.textContent?.length ?? 0,
            }
          : null;
      return {
        focused: document.activeElement === root,
        selectionCollapsed: selection?.isCollapsed ?? false,
        anchorTag:
          anchorNode instanceof Element
            ? anchorNode.tagName
            : (anchorNode?.parentElement?.tagName ?? null),
        anchorOffset: selection?.anchorOffset ?? null,
        activeItem: itemState(activeItem),
        tokenItem: itemState(tokenItem),
        caretInTokenItem: !!activeItem && activeItem === tokenItem,
        caretInSiblingItem:
          !!activeItem &&
          !!tokenItem &&
          activeItem !== tokenItem &&
          activeItem.parentElement === tokenItem.parentElement,
      };
    }, token);
  const listRowCount = async (kind: "styled" | "ul" | "ol") =>
    editor.evaluate((root: HTMLElement, type: string) => {
      if (type === "styled") {
        const rows = [
          ...(root.matches("div") ? [root] : []),
          ...Array.from(root.querySelectorAll<HTMLElement>("div")),
        ];
        return rows.filter((row) => {
          const marker = row.firstElementChild;
          const text = row.lastElementChild;
          return (
            getComputedStyle(row).display === "flex" &&
            marker?.tagName === "SPAN" &&
            /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
            text?.tagName === "SPAN"
          );
        }).length;
      }
      return root.querySelectorAll(`${type} > li`).length;
    }, kind);
  const createList = async (kind: "styled" | "ul" | "ol") => {
    const before = await listRowCount(kind);
    const suffix = activeIndex.toString(36);
    const firstToken = `firstFuzz${suffix}`;
    const secondToken = `secondFuzz${suffix}`;
    await newPlainLine(`${kind} list`);
    let afterShortcut = before;
    if (kind === "styled") {
      await typeBurst("-", true);
      await typeBurst(" ", false);
      afterShortcut = await listRowCount(kind);
      if (afterShortcut <= before) {
        throw new Error(
          `styled bullet shortcut did not add a row (${JSON.stringify({ before, afterShortcut, state: await shortcutState() })})`,
        );
      }
      await typeText(firstToken);
    } else {
      await runSlashCommand(kind === "ul" ? "bulletList" : "orderedList");
      await typeText(firstToken);
    }
    const caretAfterFirst =
      kind === "styled" ? null : await listCaretState(firstToken);
    if (caretAfterFirst && !caretAfterFirst.caretInTokenItem) {
      throw new Error(
        `${kind} caret left its list item after typing (${JSON.stringify(caretAfterFirst)})`,
      );
    }
    const afterFirst = await listRowCount(kind);
    await editor.press(lineEndKey);
    const caretAfterLineEnd =
      kind === "styled" ? null : await listCaretState(firstToken);
    if (caretAfterLineEnd && !caretAfterLineEnd.caretInTokenItem) {
      throw new Error(
        `${kind} caret left its list item at the line end (${JSON.stringify(caretAfterLineEnd)})`,
      );
    }
    await editor.press("Enter");
    const caretAfterEnter =
      kind === "styled" ? null : await listCaretState(firstToken);
    if (caretAfterEnter && !caretAfterEnter.caretInSiblingItem) {
      throw new Error(
        `${kind} Enter did not move the caret into a sibling list item (${JSON.stringify(caretAfterEnter)})`,
      );
    }
    await typeText(secondToken);
    const after = await listRowCount(kind);
    const siblingEntries = await editor.evaluate(
      (
        root: HTMLElement,
        values: { kind: string; first: string; second: string },
      ) => {
        const points: Array<{ text: Text; offset: number }> = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let visible = "";
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (text.data[offset] === "\u200b") continue;
            points.push({ text, offset });
            visible += text.data[offset] === "\u00a0" ? " " : text.data[offset];
          }
        }
        const entryFor = (token: string) => {
          const start = visible.lastIndexOf(token);
          if (start < 0) return null;
          const firstPoint = points[start];
          const lastPoint = points[start + token.length - 1];
          if (!firstPoint || !lastPoint) return null;
          const firstElement = firstPoint.text.parentElement;
          const lastElement = lastPoint.text.parentElement;
          if (values.kind === "styled") {
            let entry = firstElement;
            while (entry && entry !== root) {
              const marker = entry.firstElementChild;
              if (
                getComputedStyle(entry).display === "flex" &&
                marker?.tagName === "SPAN" &&
                /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "")
              ) {
                return entry.contains(lastElement) &&
                  entry.textContent?.includes(token)
                  ? entry
                  : null;
              }
              entry = entry.parentElement;
            }
            return null;
          }
          const item = firstElement?.closest<HTMLElement>("li");
          return item &&
            item.contains(lastElement) &&
            item.parentElement?.tagName === values.kind.toUpperCase()
            ? item
            : null;
        };
        const first = entryFor(values.first);
        const second = entryFor(values.second);
        return Boolean(
          first &&
          second &&
          first !== second &&
          first.parentElement === second.parentElement,
        );
      },
      { kind, first: firstToken, second: secondToken },
    );
    if (after <= afterFirst || !siblingEntries) {
      const state = await editor.evaluate(
        (root: HTMLElement, tokens: string[]) => {
          const selection = window.getSelection();
          const anchor = selection?.anchorNode;
          const element =
            anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
          const tokenLocation = (token: string) => {
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_TEXT,
            );
            const points: Array<{ text: Text; offset: number }> = [];
            let visible = "";
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const text = node as Text;
              for (let offset = 0; offset < text.length; offset += 1) {
                if (text.data[offset] === "\u200b") continue;
                points.push({ text, offset });
                visible +=
                  text.data[offset] === "\u00a0" ? " " : text.data[offset];
              }
            }
            const start = visible.lastIndexOf(token);
            const firstPoint = start < 0 ? null : points[start];
            const lastPoint =
              start < 0 ? null : points[start + token.length - 1];
            if (!firstPoint || !lastPoint) return null;
            const firstElement = firstPoint.text.parentElement;
            const item = firstElement?.closest("li");
            const lastElement = lastPoint.text.parentElement;
            const ancestors: string[] = [];
            for (
              let current: Element | null = firstElement;
              current && root.contains(current);
              current = current.parentElement
            ) {
              ancestors.push(current.tagName);
              if (current === root) break;
            }
            return {
              ancestors,
              blockTag:
                firstElement?.closest(
                  "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
                )?.tagName ?? null,
              listTag: item?.parentElement?.tagName ?? null,
              sameListItem: !!item && item.contains(lastElement),
            };
          };
          const rows = [
            ...(root.matches("div") ? [root] : []),
            ...Array.from(root.querySelectorAll<HTMLElement>("div")),
          ];
          return {
            focused: document.activeElement === root,
            caretInside: !!anchor && root.contains(anchor),
            anchorTag: element?.tagName ?? null,
            rootDisplay: getComputedStyle(root).display,
            lists: {
              styled: rows.filter((row) => {
                const marker = row.firstElementChild;
                return (
                  getComputedStyle(row).display === "flex" &&
                  marker?.tagName === "SPAN" &&
                  /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
                  row.lastElementChild?.tagName === "SPAN"
                );
              }).length,
              unordered: root.querySelectorAll("ul > li").length,
              ordered: root.querySelectorAll("ol > li").length,
            },
            lastBlocks: Array.from(root.children)
              .slice(-8)
              .map((block) => ({
                tag: block.tagName,
                children: Array.from(block.children, (child) => child.tagName),
                textLength: block.textContent?.length ?? 0,
                hasFirst: block.textContent?.includes(tokens[0] ?? "") ?? false,
                hasSecond:
                  block.textContent?.includes(tokens[1] ?? "") ?? false,
                display: getComputedStyle(block).display,
              })),
            caretAncestors: (() => {
              const tags: string[] = [];
              for (
                let current = element;
                current && root.contains(current);
                current = current.parentElement
              ) {
                tags.push(current.tagName);
                if (current === root) break;
              }
              return tags;
            })(),
            firstTokenPresent: root.textContent?.includes(tokens[0] ?? ""),
            secondTokenPresent: root.textContent?.includes(tokens[1] ?? ""),
            firstTokenLocation: tokenLocation(tokens[0] ?? ""),
            secondTokenLocation: tokenLocation(tokens[1] ?? ""),
          };
        },
        [firstToken, secondToken],
      );
      throw new Error(
        `${kind} Enter did not create a sibling list item (${JSON.stringify({ before, afterShortcut, afterFirst, after, siblingEntries, caretAfterFirst, caretAfterLineEnd, caretAfterEnter, state })})`,
      );
    }
    return { firstToken, secondToken };
  };
  const isNestedListToken = async (token: string) =>
    editor.evaluate((root: HTMLElement, value: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node as Text).data.includes(value)) continue;
        const item = (node as Text).parentElement?.closest("li");
        return !!item?.parentElement?.parentElement?.closest("li");
      }
      return false;
    }, token);
  const rowIndent = async (token: string) =>
    editor.evaluate((root: HTMLElement, value: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node as Text).data.includes(value)) continue;
        const row = (node as Text).parentElement?.closest<HTMLElement>(
          '[style*="display: flex"]',
        );
        return row
          ? Number.parseFloat(getComputedStyle(row).paddingLeft)
          : null;
      }
      return null;
    }, token);
  const slideClipboardType = "application/x-agent-native-slide-text";
  const paste = async (
    html: string | null,
    text: string,
    slideClipboard?: string,
  ) =>
    editor.evaluate(
      (
        root: HTMLElement,
        data: {
          html: string | null;
          text: string;
          slideClipboard?: string;
          slideClipboardType: string;
        },
      ) => {
        const clipboard = new DataTransfer();
        clipboard.setData("text/plain", data.text);
        if (data.html) clipboard.setData("text/html", data.html);
        if (data.slideClipboard)
          clipboard.setData(data.slideClipboardType, data.slideClipboard);
        const event = new Event("paste", {
          bubbles: true,
          cancelable: true,
        }) as ClipboardEvent;
        // Firefox drops clipboardData from synthetic ClipboardEvent constructors.
        Object.defineProperty(event, "clipboardData", { value: clipboard });
        root.dispatchEvent(event);
        const selection = window.getSelection();
        return {
          defaultPrevented: event.defaultPrevented,
          clipboardText: event.clipboardData?.getData("text/plain") ?? null,
          focused: document.activeElement === root,
          selectionInside: Boolean(
            selection &&
            root.contains(selection.anchorNode) &&
            root.contains(selection.focusNode),
          ),
          selectionCollapsed: selection?.isCollapsed ?? null,
        };
      },
      {
        html,
        text,
        slideClipboardType,
        ...(slideClipboard ? { slideClipboard } : {}),
      },
    );
  const copySelection = async () =>
    editor.evaluate((root: HTMLElement, type: string) => {
      const clipboard = new DataTransfer();
      const event = new Event("copy", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) {
        throw new Error("the editor did not handle rich inline copy");
      }
      return {
        html: clipboard.getData("text/html"),
        text: clipboard.getData("text/plain"),
        slideClipboard: clipboard.getData(type),
      };
    }, slideClipboardType);
  const assertRichPasteStructure = async (suffix: string) => {
    const state = await editor.evaluate(
      (root: HTMLElement, tokenSuffix: string) => {
        const tokenNode = (token: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if ((node as Text).data.includes(token)) return node as Text;
          }
          return null;
        };
        const inside = (node: Text | null, selector: string) =>
          !!node?.parentElement?.closest(selector);
        const bold = tokenNode(`DocsBold${tokenSuffix}`);
        const italic = tokenNode(`DocStyleTwo${tokenSuffix}`);
        const listItems = Array.from(root.querySelectorAll("ul > li"));
        return {
          boldPreserved: inside(bold, "strong, b, span[style*='font-weight']"),
          italicPreserved: inside(italic, "em, i, span[style*='font-style']"),
          listItemsPreserved:
            listItems.filter(
              (item) =>
                (item.textContent ?? "").includes(
                  `DocStyleOne${tokenSuffix}`,
                ) ||
                (item.textContent ?? "").includes(`DocStyleTwo${tokenSuffix}`),
            ).length >= 2,
        };
      },
      suffix,
    );
    if (!state.boldPreserved)
      throw new Error("rich paste lost the Docs bold formatting");
    if (!state.italicPreserved)
      throw new Error("rich paste lost the inline italic formatting");
    if (!state.listItemsPreserved)
      throw new Error("rich paste lost the list structure");
  };
  const makeCrossBlockSelection = async () => {
    const { firstToken, secondToken } = await createList("ul");
    await editor.evaluate(
      (root: HTMLElement, tokens: string[]) => {
        const points: Array<{ text: Text; offset: number }> = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          for (let offset = 0; offset < text.length; offset += 1) {
            if (text.data[offset] !== "\u200b") points.push({ text, offset });
          }
        }
        const visible = points
          .map(({ text, offset }) =>
            text.data[offset] === "\u00a0" ? " " : text.data[offset],
          )
          .join("");
        const firstAt = visible.indexOf(tokens[0] ?? "");
        const secondAt = visible.indexOf(
          tokens[1] ?? "",
          firstAt + (tokens[0]?.length ?? 0),
        );
        if (firstAt < 0 || secondAt < 0)
          throw new Error("could not locate cross-block fuzz tokens");
        const first = points[firstAt]!;
        const last = points[secondAt]!;
        let firstBlock = first.text.parentElement;
        let lastBlock = last.text.parentElement;
        while (
          firstBlock &&
          firstBlock !== root &&
          !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(firstBlock.tagName)
        )
          firstBlock = firstBlock.parentElement;
        while (
          lastBlock &&
          lastBlock !== root &&
          !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(lastBlock.tagName)
        )
          lastBlock = lastBlock.parentElement;
        if (!firstBlock || !lastBlock || firstBlock === lastBlock) {
          const describe = (block: HTMLElement | null) =>
            block
              ? {
                  tag: block.tagName,
                  textLength: block.textContent?.length ?? 0,
                  children: Array.from(
                    block.children,
                    (child) => child.tagName,
                  ),
                }
              : null;
          throw new Error(
            `fuzz tokens did not land in separate blocks (${JSON.stringify({ tokens, first: describe(firstBlock), second: describe(lastBlock) })})`,
          );
        }
        const range = document.createRange();
        range.setStart(first.text, first.offset);
        range.setEnd(last.text, last.offset + 1);
        const selection = window.getSelection();
        if (!selection) throw new Error("browser selection is unavailable");
        selection.removeAllRanges();
        selection.addRange(range);
      },
      [firstToken, secondToken],
    );
  };
  const placeReplacementCaret = async () =>
    editor.evaluate((root: HTMLElement) => {
      if (document.activeElement !== root) root.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("replacement has no browser selection");
      const isVisible = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      let lastText: Text | null = null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (
          text.length &&
          text.parentElement &&
          isVisible(text.parentElement)
        ) {
          lastText = text;
        }
      }
      const range = document.createRange();
      if (lastText) {
        range.setStart(lastText, lastText.length);
        range.collapse(true);
      } else {
        const emptyBlock = [
          ...(root.matches("p,div,li,blockquote,h1,h2,h3,h4,h5,h6,pre")
            ? [root]
            : []),
          ...root.querySelectorAll<HTMLElement>(
            "p,div,li,blockquote,h1,h2,h3,h4,h5,h6,pre",
          ),
        ]
          .reverse()
          .find(
            (element) =>
              !element.textContent?.replaceAll(/[\u200b\ufeff\s]/g, "") &&
              isVisible(element),
          );
        range.selectNodeContents(emptyBlock ?? root);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
      const caretTarget =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      caretTarget?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (!root.contains(selection.focusNode) || !selection.isCollapsed) {
        throw new Error("replacement could not place a caret in the editor");
      }
    });
  const dispatchReplacement = async () => {
    const initial = await inspectSelection();
    if (!initial.inside || !initial.collapsed) await placeReplacementCaret();
    const before = await inspectSelection();
    if (!before.inside || !before.collapsed)
      throw new Error("replacement needs a caret in the editor");
    await typeText("teh");
    const typed = await inspectSelection();
    if (
      !typed.inside ||
      !typed.collapsed ||
      typed.start !== before.start + "teh".length
    )
      throw new Error("autocorrect sample did not stay at the original caret");
    const replacementStart = typed.start - "teh".length;
    const expected =
      typed.text.slice(0, replacementStart) +
      "the" +
      typed.text.slice(typed.start);
    await editor.evaluate((root: HTMLElement, targetStart: number) => {
      const points: Array<{ text: Text; offset: number }> = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let visible = "";
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        for (let offset = 0; offset < text.length; offset += 1) {
          if (text.data[offset] === "\u200b") continue;
          points.push({ text, offset });
          visible += text.data[offset] === "\u00a0" ? " " : text.data[offset];
        }
      }
      if (visible.slice(targetStart, targetStart + 3) !== "teh") {
        throw new Error(
          "autocorrect sample could not be found at the typed caret",
        );
      }
      const first = points[targetStart];
      const last = points[targetStart + 2];
      if (!first || !last)
        throw new Error("autocorrect target range is unavailable");
      const target = document.createRange();
      target.setStart(first.text, first.offset);
      target.setEnd(last.text, last.offset + 1);
      if (target.toString().replaceAll("\u200b", "") !== "teh") {
        throw new Error(
          "autocorrect target range did not select the typed token",
        );
      }
      const selection = window.getSelection();
      if (!selection) throw new Error("browser selection is unavailable");
      selection.collapse(root, root.childNodes.length);
      const event = new InputEvent("beforeinput", {
        inputType: "insertReplacementText",
        data: "the",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "getTargetRanges", {
        value: () => [target],
      });
      root.dispatchEvent(event);
    }, replacementStart);
    const after = await inspectSelection();
    if (
      !after.inside ||
      !after.collapsed ||
      after.text !== expected ||
      after.start !== typed.start
    )
      throw new Error(
        "insertReplacementText did not replace the selected token at its range",
      );
  };

  try {
    await editor.waitFor({ state: "visible", timeout: 5000 });
    if (options.expectScaledSlide) {
      await assertSlideIsScaled(page, slideSelector);
    }
    const { originalHtml, originalSlideHtml } = options;
    outsideBaseline = await snapshotOutside();
    slideScrollBaseline = await slideScrollState();

    for (activeIndex = 0; activeIndex < plan.length; activeIndex += 1) {
      activePhase = `step ${activeIndex}`;
      const operation = plan[activeIndex];
      let skipFinalSiblingCheck = false;
      tracePhase("sibling-capture:start");
      await snapshotEditorSiblings("capture", operation);
      tracePhase("sibling-capture:end");
      tracePhase("operation:start");
      switch (operation.kind) {
        case "type":
          await typeText(operation.value);
          break;
        case "shortcut":
          await newPlainLine(`${operation.result} shortcut`);
          {
            const before = await shortcutResultCount(operation.result);
            const prefix = operation.value.slice(0, -1);
            const trigger = operation.value.slice(-1);
            await typeBurst(prefix, operation.result !== "divider");
            const beforeTrigger = await shortcutState();
            await typeBurst(trigger, false);
            await assertShortcut(
              operation.result,
              before,
              operation.value,
              beforeTrigger,
            );
            await typeBurst("q", true);
          }
          break;
        case "slash": {
          await runSlashCommand(operation.value);
          await typeBurst("q", true);
          break;
        }
        case "slash-tab":
          await runSlashCommand("heading2", "Tab");
          break;
        case "slash-escape": {
          const before = await inspectSelection();
          const listbox = await openSlashMenu();
          const withTrigger = await inspectSelection();
          const listboxId = await slashListboxId(listbox);
          if (slashCount(withTrigger.text) !== slashCount(before.text) + 1)
            throw new Error("slash menu did not insert a single trigger token");
          await page.keyboard.press("Escape");
          await waitForSlashMenuHidden(listboxId);
          if (
            slashCount((await inspectSelection()).text) !==
            slashCount(withTrigger.text)
          )
            throw new Error("Escape changed the unselected slash token");
          break;
        }
        case "slash-filter": {
          const emptyListbox = await openSlashMenu();
          const emptyListboxId = await slashListboxId(emptyListbox);
          await typeText("zz-no-command");
          await waitForSlashMenuHidden(emptyListboxId);
          const listbox = await openSlashMenu();
          await typeText("heading 2");
          const options = listbox.locator('[role="option"]');
          if ((await options.count()) !== 1)
            throw new Error("slash query did not filter to one command");
          const headingOptionId = await options.getAttribute("id");
          if (
            !headingOptionId ||
            (await editor.getAttribute("aria-activedescendant")) !==
              headingOptionId
          ) {
            throw new Error("slash filtering selected the wrong command");
          }
          const withQuery = await inspectSelection();
          const listboxId = await slashListboxId(listbox);
          await page.keyboard.press("Enter");
          await waitForSlashMenuHidden(listboxId);
          if (
            slashCount((await inspectSelection()).text) !==
            slashCount(withQuery.text) - 1
          )
            throw new Error("filtered slash command did not consume its query");
          break;
        }
        case "slash-away": {
          const listbox = await openSlashMenu();
          const listboxId = await slashListboxId(listbox);
          await page.keyboard.press("ArrowLeft");
          await waitForSlashMenuHidden(listboxId);
          break;
        }
        case "slash-delete": {
          const listbox = await openSlashMenu();
          const listboxId = await slashListboxId(listbox);
          const beforeDelete = await inspectSelection();
          await page.keyboard.press("Backspace");
          await waitForSlashMenuHidden(listboxId);
          if (
            slashCount((await inspectSelection()).text) !==
            slashCount(beforeDelete.text) - 1
          )
            throw new Error("deleting slash did not remove its trigger token");
          break;
        }
        case "slash-position": {
          await newLine();
          await typeText("and");
          await typeText("/");
          await assertSlashMenuStaysHidden();
          await typeText("or https:");
          await typeText("/");
          await assertSlashMenuStaysHidden();
          await typeText("/example.com ");
          await typeText("/");
          const listbox = await waitForControlledSlashListbox();
          await listbox
            .locator('[role="option"]')
            .first()
            .waitFor({ state: "visible", timeout: 5000 });
          const listboxId = await slashListboxId(listbox);
          await page.keyboard.press("Escape");
          await waitForSlashMenuHidden(listboxId);
          break;
        }
        case "slash-outside": {
          const listbox = await openSlashMenu();
          const listboxId = await slashListboxId(listbox);
          const point = await editor.evaluate(
            (root: HTMLElement, id: string) => {
              const menu = document.getElementById(id);
              const overlay =
                menu?.closest<HTMLElement>(
                  "[data-radix-popper-content-wrapper]",
                ) ?? menu;
              const rect = root.getBoundingClientRect();
              const candidates = [
                [rect.left + 2, rect.top + 2],
                [rect.right - 2, rect.top + 2],
                [rect.left + 2, rect.bottom - 2],
                [rect.right - 2, rect.bottom - 2],
                [rect.left + rect.width / 2, rect.top + 2],
                [rect.left + rect.width / 2, rect.bottom - 2],
              ];
              return candidates.find(([x, y]) => {
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
                  return false;
                const hit = document.elementFromPoint(x, y);
                return !!hit && root.contains(hit) && !overlay?.contains(hit);
              });
            },
            listboxId,
          );
          if (!point) {
            throw new Error(
              "could not find an in-editor point outside the slash menu",
            );
          }
          await page.mouse.click(point[0], point[1]);
          await waitForSlashMenuHidden(listboxId);
          await assertCaret();
          break;
        }
        case "shortcut-undo": {
          await newLine();
          await typeText("# ", true, true);
          const converted = await editor.evaluate(
            (root: HTMLElement) =>
              root.matches("h1") || !!root.querySelector("h1"),
          );
          if (!converted)
            throw new Error("heading shortcut did not convert before undo");
          await page.keyboard.press(`${modifier}+Z`);
          if (!(await inspectSelection()).text.includes("# ")) {
            throw new Error(
              "undo did not restore literal heading shortcut text",
            );
          }
          break;
        }
        case "slash-undo": {
          const listbox = await openSlashMenu();
          await typeText("heading 2");
          await listbox
            .locator('[role="option"]')
            .first()
            .waitFor({ state: "visible", timeout: 5000 });
          const listboxId = await slashListboxId(listbox);
          await page.keyboard.press("Enter");
          await waitForSlashMenuHidden(listboxId);
          await page.keyboard.press(`${modifier}+Z`);
          if (!(await inspectSelection()).text.includes("/heading 2")) {
            throw new Error("undo did not restore literal slash command text");
          }
          break;
        }
        case "heading-backspace":
        case "quote-backspace": {
          if (operation.kind === "quote-backspace") {
            await newPlainLine();
            await runSlashCommand("quote");
            const leadingSpaceToken = `space${activeIndex}`;
            await typeText(` ${leadingSpaceToken}`);
            await placeCaretAtToken(leadingSpaceToken, "start");
            const quoteState = async () =>
              editor.evaluate((root: HTMLElement, token: string) => {
                const quotes = [
                  ...(root.matches("blockquote") ? [root] : []),
                  ...Array.from(
                    root.querySelectorAll<HTMLElement>("blockquote"),
                  ),
                ];
                const quote = quotes
                  .reverse()
                  .find((block) => block.textContent?.includes(token));
                const text =
                  quote?.textContent
                    ?.replaceAll("\u200b", "")
                    .replaceAll("\u00a0", " ") ?? null;
                const tokenStart = text?.indexOf(token) ?? -1;
                return {
                  text,
                  tag: quote?.tagName ?? null,
                  prefix: tokenStart < 0 ? null : text?.slice(0, tokenStart),
                };
              }, leadingSpaceToken);
            const quoteBeforeDelete = await quoteState();
            if (
              quoteBeforeDelete.tag !== "BLOCKQUOTE" ||
              quoteBeforeDelete.prefix !== " "
            ) {
              throw new Error(
                `${operation.kind} setup did not place the token after a leading space in a quote (${JSON.stringify(quoteBeforeDelete)})`,
              );
            }
            await snapshotEditorSiblings("capture", operation);
            await editor.press("Backspace");
            const whitespaceDelete = await quoteState();
            if (
              whitespaceDelete.tag !== "BLOCKQUOTE" ||
              whitespaceDelete.text !== leadingSpaceToken
            ) {
              throw new Error(
                `${operation.kind} did not preserve native leading-space deletion (${JSON.stringify({ before: quoteBeforeDelete, after: whitespaceDelete })})`,
              );
            }
            const whitespaceSiblingChanges = await snapshotEditorSiblings(
              "assert",
              operation,
            );
            if (whitespaceSiblingChanges.length) {
              throw new Error(
                `${operation.kind} moved or restyled a sibling while deleting leading whitespace: ${whitespaceSiblingChanges.slice(0, 5).join(", ")}`,
              );
            }
          }
          await newPlainLine();
          await runSlashCommand(
            operation.kind === "heading-backspace" ? "heading2" : "quote",
          );
          const token = `edge${activeIndex}`;
          await typeText(token);
          await placeCaretAtToken(token, "start");
          const blockSelector =
            operation.kind === "heading-backspace"
              ? "h1,h2,h3,h4,h5,h6"
              : "blockquote";
          const tokenInBlock = await editor.evaluate(
            (root: HTMLElement, values: { selector: string; token: string }) =>
              (root.matches(values.selector) ? [root] : [])
                .concat(
                  Array.from(
                    root.querySelectorAll<HTMLElement>(values.selector),
                  ),
                )
                .some((block) => block.textContent?.includes(values.token)),
            { selector: blockSelector, token },
          );
          if (!tokenInBlock) {
            throw new Error(
              `${operation.kind} setup did not place its token in the requested block`,
            );
          }
          await snapshotEditorSiblings("capture", operation);
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringFuzzDeleteProbe?: {
                events: Array<Record<string, unknown>>;
                listener: (event: Event) => void;
              };
            };
            const events: Array<Record<string, unknown>> = [];
            const listener = (event: Event) => {
              const input = event as InputEvent;
              const record = {
                inputType: input.inputType,
                cancelable: input.cancelable,
                defaultPrevented: false,
                isComposing: input.isComposing,
                targetTag:
                  input.target instanceof Element
                    ? input.target.tagName
                    : input.target instanceof Node
                      ? input.target.nodeName
                      : null,
                eventPhase: input.eventPhase,
                selection: (() => {
                  const selection = window.getSelection();
                  const range = selection?.rangeCount
                    ? selection.getRangeAt(0)
                    : null;
                  return {
                    collapsed: selection?.isCollapsed ?? false,
                    inside:
                      !!selection &&
                      root.contains(selection.anchorNode) &&
                      root.contains(selection.focusNode),
                    startTag:
                      range?.startContainer instanceof Element
                        ? range.startContainer.tagName
                        : (range?.startContainer.parentElement?.tagName ??
                          null),
                    startOffset: range?.startOffset ?? null,
                    startTextLength:
                      range?.startContainer instanceof Text
                        ? range.startContainer.length
                        : null,
                    boundary:
                      range?.startContainer instanceof Element
                        ? {
                            childCount: range.startContainer.childNodes.length,
                            before:
                              range.startContainer.childNodes[
                                range.startOffset - 1
                              ]?.nodeName ?? null,
                            at:
                              range.startContainer.childNodes[range.startOffset]
                                ?.nodeName ?? null,
                            after:
                              range.startContainer.childNodes[
                                range.startOffset + 1
                              ]?.nodeName ?? null,
                            ancestors: (() => {
                              const tags: string[] = [];
                              for (
                                let current: Element | null =
                                  range.startContainer as Element;
                                current && root.contains(current);
                                current = current.parentElement
                              ) {
                                tags.push(current.tagName);
                                if (current === root) break;
                              }
                              return tags;
                            })(),
                          }
                        : null,
                  };
                })(),
              };
              events.push(record);
              queueMicrotask(() => {
                record.defaultPrevented = input.defaultPrevented;
              });
            };
            root.addEventListener("beforeinput", listener, true);
            scope.__authoringFuzzDeleteProbe = { events, listener };
          });
          await editor.press("Backspace");
          const deleteInputEvents = await editor.evaluate(
            (root: HTMLElement) => {
              const scope = window as Window & {
                __authoringFuzzDeleteProbe?: {
                  events: Array<Record<string, unknown>>;
                  listener: (event: Event) => void;
                };
              };
              const probe = scope.__authoringFuzzDeleteProbe;
              if (probe) {
                root.removeEventListener("beforeinput", probe.listener, true);
                delete scope.__authoringFuzzDeleteProbe;
              }
              return probe?.events ?? [];
            },
          );
          const demotion = await editor.evaluate(
            (
              root: HTMLElement,
              values: { selector: string; token: string },
            ) => {
              const blocks = [
                ...(root.matches(values.selector) ? [root] : []),
                ...Array.from(
                  root.querySelectorAll<HTMLElement>(values.selector),
                ),
              ];
              return {
                tokenPresent: root.textContent?.includes(values.token) ?? false,
                remainingBlockTag:
                  blocks.find((block) =>
                    block.textContent?.includes(values.token),
                  )?.tagName ?? null,
              };
            },
            { selector: blockSelector, token },
          );
          if (!demotion.tokenPresent || demotion.remainingBlockTag) {
            throw new Error(
              `${operation.kind} did not demote the block (${JSON.stringify({ ...demotion, deleteInputEvents })})`,
            );
          }
          const demotionSiblingChanges = await snapshotEditorSiblings(
            "assert",
            operation,
          );
          if (demotionSiblingChanges.length) {
            throw new Error(
              `${operation.kind} moved or restyled a sibling while demoting: ${demotionSiblingChanges.slice(0, 5).join(", ")}`,
            );
          }
          await snapshotEditorSiblings("capture", operation);
          await editor.press("Backspace");
          if (!(await inspectSelection()).text.includes(token)) {
            throw new Error(`${operation.kind} second Backspace lost text`);
          }
          // The second press intentionally merges the demoted block with its
          // predecessor, so the final sibling snapshot would reject that edit.
          skipFinalSiblingCheck = true;
          break;
        }
        case "heading-enter": {
          await runSlashCommand("heading2");
          const token = `heading${activeIndex}`;
          await typeText(token);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          const headingState = await editor.evaluate(
            (root: HTMLElement, value: string) => {
              const headings = [
                ...(root.matches("h2") ? [root] : []),
                ...Array.from(root.querySelectorAll<HTMLElement>("h2")),
              ];
              const heading = headings.find((candidate) =>
                candidate.textContent?.includes(value),
              );
              const selection = window.getSelection();
              let caretBlock = selection?.anchorNode ?? null;
              while (
                caretBlock &&
                caretBlock !== root &&
                !(
                  caretBlock instanceof HTMLElement &&
                  caretBlock.tagName === "P"
                )
              ) {
                caretBlock = caretBlock.parentNode;
              }
              const paragraph =
                caretBlock instanceof HTMLElement && caretBlock.tagName === "P"
                  ? caretBlock
                  : null;
              let createdParagraph = false;
              const headingPath: Array<{
                tag: string;
                nextTag: string | null;
              }> = [];
              for (
                let current: HTMLElement | null = heading ?? null;
                current && current !== root;
                current = current.parentElement
              ) {
                headingPath.push({
                  tag: current.tagName,
                  nextTag: current.nextElementSibling?.tagName ?? null,
                });
                if (paragraph && current.nextElementSibling === paragraph) {
                  createdParagraph = true;
                  break;
                }
              }
              return {
                createdParagraph,
                headingFound: !!heading,
                headingPath,
                caretBlockTag:
                  caretBlock instanceof HTMLElement ? caretBlock.tagName : null,
              };
            },
            token,
          );
          if (!headingState.createdParagraph) {
            throw new Error(
              `Enter at heading end did not create a paragraph (${JSON.stringify(headingState)})`,
            );
          }
          break;
        }
        case "quote-exit": {
          await runSlashCommand("quote");
          const token = `quote${activeIndex}`;
          await typeText(token);
          const quoteContainsToken = await editor.evaluate(
            (root: HTMLElement, value: string) =>
              Array.from(root.querySelectorAll("blockquote")).some((quote) =>
                quote.textContent?.includes(value),
              ),
            token,
          );
          if (!quoteContainsToken) {
            throw new Error("slash quote did not contain its token");
          }
          await editor.press("Enter");
          await editor.press("Enter");
          const after = `after${activeIndex}`;
          await typeText(after);
          const exited = await editor.evaluate(
            (root: HTMLElement, values: { token: string; after: string }) =>
              Array.from(root.querySelectorAll("blockquote")).some((quote) => {
                if (!quote.textContent?.includes(values.token)) return false;
                const following = Array.from(
                  root.querySelectorAll<HTMLElement>("p"),
                ).find((paragraph) =>
                  paragraph.textContent?.includes(values.after),
                );
                return (
                  !!following &&
                  Boolean(
                    quote.compareDocumentPosition(following) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
                  )
                );
              }),
            { token, after },
          );
          if (!exited)
            throw new Error(
              "Enter did not exit the quote into a following paragraph",
            );
          break;
        }
        case "empty-list-exit": {
          const { secondToken } = await createList("ul");
          await placeCaretAtToken(secondToken, "end");
          const beforeEnter = await listCaretState(secondToken);
          await page.keyboard.press(lineEndKey);
          const afterLineEnd = await listCaretState(secondToken);
          await page.keyboard.press("Enter");
          const afterFirstEnter = await listCaretState(secondToken);
          if (
            !afterFirstEnter.activeItem ||
            afterFirstEnter.caretInTokenItem ||
            afterFirstEnter.activeItem.parentTag !== "UL"
          ) {
            throw new Error(
              `Enter did not create an empty list item (${JSON.stringify({ beforeEnter, afterLineEnd, afterFirstEnter })})`,
            );
          }
          await snapshotEditorSiblings("capture", operation);
          await page.keyboard.press("Enter");
          const result = await editor.evaluate(
            (root: HTMLElement, expected: string) =>
              (() => {
                const state = window as Window & {
                  __authoringFuzzSiblingSnapshot?: {
                    emptyListExit?: {
                      item: HTMLElement;
                      paragraphs: HTMLElement[];
                    };
                  };
                };
                const emptyListExit =
                  state.__authoringFuzzSiblingSnapshot?.emptyListExit;
                const item = emptyListExit?.item;
                const existingParagraphs = new Set(
                  emptyListExit?.paragraphs ?? [],
                );
                const list = Array.from(root.querySelectorAll("ul,ol")).find(
                  (candidate) => candidate.textContent?.includes(expected),
                );
                const paragraph = list?.nextElementSibling;
                const selection = window.getSelection();
                const caretParagraph =
                  selection?.focusNode instanceof Element
                    ? selection.focusNode.closest("p")
                    : selection?.focusNode?.parentElement?.closest("p");
                return {
                  itemRemoved: !!item && !root.contains(item),
                  listFollowedByNewParagraph:
                    paragraph?.tagName === "P" &&
                    !existingParagraphs.has(paragraph as HTMLElement),
                  caretInNewParagraph:
                    paragraph?.tagName === "P" &&
                    caretParagraph === paragraph &&
                    selection?.isCollapsed === true &&
                    root.contains(selection.focusNode),
                  editorKeptFocus: document.activeElement === root,
                };
              })(),
            secondToken,
          );
          if (
            !result.itemRemoved ||
            !result.listFollowedByNewParagraph ||
            !result.caretInNewParagraph ||
            !result.editorKeptFocus
          )
            throw new Error(
              `Enter on an empty list item did not exit the list (${JSON.stringify(result)})`,
            );
          break;
        }
        case "soft-break": {
          await newLine();
          await typeText(`soft${activeIndex}`);
          const breaksBefore = await editor.locator("br").count();
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringSoftBreakProbe?: {
                root: HTMLElement;
                events: Array<Record<string, unknown>>;
                keydown: (event: KeyboardEvent) => void;
                beforeinput: (event: InputEvent) => void;
              };
            };
            const events: Array<Record<string, unknown>> = [];
            const keydown = (event: KeyboardEvent) => {
              events.push({
                type: "keydown",
                key: event.key,
                shiftKey: event.shiftKey,
                defaultPrevented: event.defaultPrevented,
              });
            };
            const beforeinput = (event: InputEvent) => {
              const record: Record<string, unknown> = {
                type: "beforeinput",
                inputType: event.inputType,
                cancelable: event.cancelable,
                defaultPrevented: event.defaultPrevented,
              };
              events.push(record);
              queueMicrotask(() => {
                record.defaultPrevented = event.defaultPrevented;
              });
            };
            root.addEventListener("keydown", keydown, true);
            root.addEventListener("beforeinput", beforeinput, true);
            scope.__authoringSoftBreakProbe = {
              root,
              events,
              keydown,
              beforeinput,
            };
          });
          await editor.press("Shift+Enter");
          const softBreakResult = await editor.evaluate(
            (root: HTMLElement, before: number) => {
              const scope = window as Window & {
                __authoringSoftBreakProbe?: {
                  root: HTMLElement;
                  events: Array<Record<string, unknown>>;
                  keydown: (event: KeyboardEvent) => void;
                  beforeinput: (event: InputEvent) => void;
                };
              };
              const probe = scope.__authoringSoftBreakProbe;
              if (!probe || probe.root !== root) {
                return {
                  breaksBefore: before,
                  breaksAfter: root.querySelectorAll("br").length,
                  events: [],
                  focused: false,
                  caretInside: false,
                };
              }
              root.removeEventListener("keydown", probe.keydown, true);
              root.removeEventListener("beforeinput", probe.beforeinput, true);
              delete scope.__authoringSoftBreakProbe;
              return {
                breaksBefore: before,
                breaksAfter: root.querySelectorAll("br").length,
                focused: root.contains(document.activeElement),
                caretInside:
                  !!window.getSelection()?.anchorNode &&
                  root.contains(window.getSelection()!.anchorNode),
                events: probe.events,
              };
            },
            breaksBefore,
          );
          if (
            softBreakResult.breaksAfter <= softBreakResult.breaksBefore ||
            !softBreakResult.focused ||
            !softBreakResult.caretInside
          ) {
            throw new Error(
              `Shift+Enter did not insert a soft break (${JSON.stringify(softBreakResult)})`,
            );
          }
          await typeText(`line${activeIndex}`);
          break;
        }
        case "list":
          await createList(operation.value);
          break;
        case "enter-block-edge":
          await editor.press(lineStartKey);
          await editor.press("Enter");
          break;
        case "backspace-block-edge": {
          await prepareParagraphPair("block-edge Backspace");
          const leftToken = `merge-left-${activeIndex}`;
          const rightToken = `merge-right-${activeIndex}`;
          await editor.press(`${modifier}+B`);
          await typeText(leftToken);
          await editor.press(`${modifier}+B`);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          if (!(await plainLineState()).valid) {
            throw new Error(
              "block-edge Backspace setup did not create a plain paragraph",
            );
          }
          await editor.press(`${modifier}+B`);
          await editor.press(`${modifier}+I`);
          await typeText(rightToken);
          await editor.press(`${modifier}+I`);
          await editor.press(`${modifier}+B`);
          await placeCaretAtToken(rightToken, "start");
          await snapshotEditorSiblings("capture", operation, true);
          await editor.press(lineStartKey);
          await editor.press("Backspace");
          break;
        }
        case "delete-block-edge": {
          await prepareParagraphPair("block-edge Delete");
          const leftToken = `delete-left-${activeIndex}`;
          const rightToken = `delete-right-${activeIndex}`;
          await editor.press(`${modifier}+B`);
          await typeText(leftToken);
          await editor.press(`${modifier}+B`);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          await editor.press(`${modifier}+B`);
          await editor.press(`${modifier}+I`);
          await typeText(rightToken);
          await editor.press(`${modifier}+I`);
          await editor.press(`${modifier}+B`);
          await placeCaretAtToken(leftToken, "end");
          await snapshotEditorSiblings("capture", operation, true);
          await editor.press("Delete");
          break;
        }
        case "enter-list-edge":
          await createList("ul");
          await snapshotEditorSiblings("capture", operation);
          {
            const before = await listRowCount("ul");
            await editor.press(lineEndKey);
            await editor.press("Enter");
            if ((await listRowCount("ul")) <= before)
              throw new Error("Enter did not add a list item at the list edge");
          }
          break;
        case "backspace-list-edge":
          {
            const { firstToken, secondToken } = await createList("styled");
            const before = await listRowCount("styled");
            await placeCaretAtToken(secondToken, "start");
            await snapshotEditorSiblings("capture", operation);
            await editor.press("Backspace");
            const afterDemotion = await listRowCount("styled");
            const firstPressState = await editor.evaluate(
              (
                root: HTMLElement,
                values: { first: string; second: string },
              ) => {
                const inspectToken = (token: string) => {
                  const walker = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_TEXT,
                  );
                  for (
                    let node = walker.nextNode();
                    node;
                    node = walker.nextNode()
                  ) {
                    if (!(node as Text).data.includes(token)) continue;
                    let row = (node as Text).parentElement;
                    while (
                      row &&
                      row !== root &&
                      getComputedStyle(row).display !== "flex"
                    ) {
                      row = row.parentElement;
                    }
                    return {
                      found: true,
                      rowTag: row?.tagName ?? null,
                      markerTag: row?.firstElementChild?.tagName ?? null,
                      markerText:
                        row?.firstElementChild?.textContent?.trim() ?? "",
                      rowDisplay: row ? getComputedStyle(row).display : null,
                      rowTextLength: row?.textContent?.length ?? 0,
                      rowContainsFirst:
                        row?.textContent?.includes(values.first) ?? false,
                      rowContainsSecond:
                        row?.textContent?.includes(values.second) ?? false,
                    };
                  }
                  return { found: false };
                };
                const selection = window.getSelection();
                return {
                  first: inspectToken(values.first),
                  second: inspectToken(values.second),
                  focused: document.activeElement === root,
                  caretInside:
                    !!selection &&
                    root.contains(selection.anchorNode) &&
                    root.contains(selection.focusNode),
                  collapsed: selection?.isCollapsed ?? false,
                  anchorTag:
                    selection?.anchorNode instanceof Element
                      ? selection.anchorNode.tagName
                      : (selection?.anchorNode?.parentElement?.tagName ?? null),
                  anchorOffset: selection?.anchorOffset ?? null,
                };
              },
              { first: firstToken, second: secondToken },
            );
            if (afterDemotion !== before - 1 || !firstPressState.second.found) {
              throw new Error(
                `first Backspace did not demote only the second styled row (${JSON.stringify({ before, afterDemotion, ...firstPressState })})`,
              );
            }
            await editor.press("Backspace");
            const text = (await inspectSelection()).text;
            const joinedRow = await editor.evaluate(
              (root: HTMLElement, values: { first: string; second: string }) =>
                [
                  ...(root.matches("div") ? [root] : []),
                  ...Array.from(root.querySelectorAll<HTMLElement>("div")),
                ].find((row) => {
                  const marker = row.firstElementChild;
                  const content = row.lastElementChild;
                  const value = content?.textContent ?? "";
                  return (
                    getComputedStyle(row).display === "flex" &&
                    marker?.tagName === "SPAN" &&
                    /^[•●◦▪‣·⁃–—-]+$/u.test(marker.textContent?.trim() ?? "") &&
                    content?.tagName === "SPAN" &&
                    value.includes(values.first) &&
                    value.includes(values.second)
                  );
                })?.outerHTML ?? null,
              { first: firstToken, second: secondToken },
            );
            if (!joinedRow) {
              throw new Error(
                `second Backspace did not join adjacent styled rows (${JSON.stringify({ before, afterDemotion, after: await listRowCount("styled"), first: firstToken, second: secondToken, bothVisible: text.includes(firstToken) && text.includes(secondToken), joinedRow })})`,
              );
            }
          }
          break;
        case "delete-list-edge":
          {
            const { firstToken, secondToken } = await createList("ol");
            const before = await listRowCount("ol");
            await placeCaretAtToken(firstToken, "end");
            await snapshotEditorSiblings("capture", operation);
            await editor.press("Delete");
            const text = (await inspectSelection()).text;
            if (
              !text.includes(firstToken) ||
              !text.includes(secondToken) ||
              (await listRowCount("ol")) >= before
            ) {
              throw new Error("Delete did not join adjacent ordered items");
            }
          }
          break;
        case "tab": {
          const { secondToken } = await createList(operation.list);
          await placeCaretAtToken(secondToken, "end");
          await snapshotEditorSiblings("capture", operation);
          if (operation.list === "styled") {
            const before = await rowIndent(secondToken);
            await editor.press("Tab");
            const after = await rowIndent(secondToken);
            if (before === null || after === null || after <= before)
              throw new Error("Tab did not indent the styled bullet row");
          } else {
            await editor.press("Tab");
            if (!(await isNestedListToken(secondToken)))
              throw new Error(`Tab did not nest the ${operation.list} item`);
          }
          break;
        }
        case "shift-tab": {
          const { secondToken } = await createList(operation.list);
          await placeCaretAtToken(secondToken, "end");
          if (operation.list === "styled") {
            const original = await rowIndent(secondToken);
            await editor.press("Tab");
            const indented = await rowIndent(secondToken);
            await snapshotEditorSiblings("capture", operation);
            await page.keyboard.press("Shift+Tab");
            const outdented = await rowIndent(secondToken);
            if (
              original === null ||
              indented === null ||
              outdented === null ||
              indented <= original ||
              outdented >= indented
            ) {
              throw new Error(
                "Shift-Tab did not outdent the styled bullet row",
              );
            }
          } else {
            await editor.press("Tab");
            if (!(await isNestedListToken(secondToken)))
              throw new Error(`Tab did not nest the ${operation.list} item`);
            await placeCaretAtToken(secondToken, "end");
            await snapshotEditorSiblings("capture", operation);
            await page.keyboard.press("Shift+Tab");
            if (await isNestedListToken(secondToken))
              throw new Error(
                `Shift-Tab did not outdent the ${operation.list} item`,
              );
          }
          break;
        }
        case "paste-plain":
          {
            const token = `plainpaste${activeIndex}`;
            const before = await inspectSelection();
            const event = await paste(null, token);
            const after = await inspectSelection();
            if (!after.text.includes(token)) {
              throw new Error(
                `plain paste did not insert at the selection: ${JSON.stringify({ event, before: { inside: before.inside, collapsed: before.collapsed, start: before.start, end: before.end }, after: { inside: after.inside, collapsed: after.collapsed, start: after.start, end: after.end } })}`,
              );
            }
          }
          break;
        case "paste-rich": {
          const suffix = String(activeIndex);
          await paste(
            `<p><strong>DocsBold${suffix}</strong> richpaste${suffix}</p><ul><li>DocStyleOne${suffix}</li><li><em>DocStyleTwo${suffix}</em></li></ul>`,
            `DocsBold${suffix} richpaste${suffix} DocStyleOne${suffix} DocStyleTwo${suffix}`,
          );
          if (!(await inspectSelection()).text.includes(`DocStyleTwo${suffix}`))
            throw new Error("rich paste did not insert the document sample");
          await assertRichPasteStructure(suffix);
          break;
        }
        case "paste-markdown": {
          await newLine();
          await paste(
            null,
            "# Fuzz heading\n- Fuzz one\n  - Fuzz nested\n- Fuzz two\n> Fuzz quote",
          );
          const blocks = await editor.evaluate((root: HTMLElement) => ({
            heading: Array.from(root.querySelectorAll("h1")).some(
              (node) => node.textContent === "Fuzz heading",
            ),
            nested: Array.from(root.querySelectorAll("ul > li ul > li")).some(
              (node) => node.textContent === "Fuzz nested",
            ),
            quote: Array.from(root.querySelectorAll("blockquote")).some(
              (node) => node.textContent === "Fuzz quote",
            ),
          }));
          if (!blocks.heading || !blocks.nested || !blocks.quote) {
            throw new Error("plain Markdown paste did not create its blocks");
          }
          break;
        }
        case "paste-url": {
          await newLine();
          const token = `url${activeIndex}`;
          await typeText(token);
          await selectToken(token);
          const pasteState = await paste(null, "https://example.com/fuzz");
          const linked = await editor.evaluate(
            (root: HTMLElement, value: string) => {
              const selection = window.getSelection();
              if (!selection?.rangeCount) return false;
              const range = selection.getRangeAt(0);
              if (range.toString().replaceAll("\u200b", "") !== value)
                return false;
              const linkedText: string[] = [];
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                const text = node as Text;
                if (!range.intersectsNode(text)) continue;
                const start =
                  text === range.startContainer ? range.startOffset : 0;
                const end =
                  text === range.endContainer ? range.endOffset : text.length;
                if (start >= end) continue;
                const selected = text.data.slice(start, end);
                if (!selected) continue;
                const link = text.parentElement?.closest("a");
                if (link?.getAttribute("href") !== "https://example.com/fuzz")
                  return false;
                linkedText.push(selected);
              }
              return linkedText.join("").replaceAll("\u200b", "") === value;
            },
            token,
          );
          if (!pasteState.defaultPrevented || !linked)
            throw new Error("URL paste did not link the complete selection");
          break;
        }
        case "link-shortcut": {
          const assertSetupUnchanged = async (stage: string) => {
            try {
              await snapshotEditorSiblings("assert", operation);
            } catch (error) {
              throw new Error(
                `link shortcut ${stage} changed a sibling: ${String(error)}`,
              );
            }
            await snapshotEditorSiblings("capture", operation);
          };
          await newLine();
          await assertSetupUnchanged("line creation");
          const token = `link${activeIndex}`;
          await typeText(token);
          await assertSetupUnchanged("typing");
          await selectToken(token);
          await assertSetupUnchanged("selection");
          const unmaskMenu = await page.addStyleTag({
            content:
              '[data-block-bubble-menu="true"] { visibility: visible !important; }',
          });
          try {
            await page.keyboard.press(modifier + "+K");
            const input = page.locator(
              '[data-block-bubble-menu="true"] input[placeholder]:visible',
            );
            await input.waitFor({ state: "visible", timeout: 5000 });
            await input.fill("https://example.com/keyboard");
            await input.press("Enter");
            const linked = await editor.evaluate(
              (root: HTMLElement, value: string) => {
                const selection = window.getSelection();
                const range =
                  selection?.rangeCount && !selection.isCollapsed
                    ? selection.getRangeAt(0)
                    : null;
                if (
                  !range ||
                  range.toString() !== value ||
                  !root.contains(range.commonAncestorContainer)
                ) {
                  return false;
                }
                let selectedText = "";
                const walker = document.createTreeWalker(
                  root,
                  NodeFilter.SHOW_TEXT,
                );
                for (
                  let node = walker.nextNode() as Text | null;
                  node;
                  node = walker.nextNode() as Text | null
                ) {
                  if (!range.intersectsNode(node)) continue;
                  const start =
                    node === range.startContainer ? range.startOffset : 0;
                  const end =
                    node === range.endContainer
                      ? range.endOffset
                      : node.data.length;
                  if (start >= end) continue;
                  const anchor = node.parentElement?.closest("a");
                  if (
                    !anchor ||
                    anchor.href !== "https://example.com/keyboard"
                  ) {
                    return false;
                  }
                  selectedText += node.data.slice(start, end);
                }
                return selectedText === value;
              },
              token,
            );
            if (!linked)
              throw new Error("Mod+K did not link all of the selected text");
          } finally {
            await unmaskMenu.evaluate((style: HTMLStyleElement) =>
              style.remove(),
            );
          }
          break;
        }
        case "vertical-navigation": {
          const firstLine = "x".repeat(4);
          const secondLine = "x".repeat(3);
          await runSlashCommand("heading2");
          await typeText(firstLine);
          await editor.press(lineEndKey);
          await editor.press("Enter");
          await runSlashCommand("heading2");
          await typeText(secondLine);
          await editor.press("ArrowLeft");
          await snapshotEditorSiblings("capture", operation);
          const before = await inspectSelection();
          const beforeRect = await editor.evaluate(
            (
              root: HTMLElement,
              values: { firstLine: string; secondLine: string },
            ) => {
              const selection = window.getSelection();
              const range = selection?.rangeCount
                ? selection.getRangeAt(0)
                : null;
              const rect = range?.getBoundingClientRect();
              const anchor = selection?.anchorNode;
              const element =
                anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
              const blockSelector = "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre";
              const candidates = [
                ...(root.matches(blockSelector) ? [root] : []),
                ...Array.from(
                  root.querySelectorAll<HTMLElement>(blockSelector),
                ),
              ];
              const normalizeText = (value: string) =>
                value.replaceAll(/[\u200b\ufeff\u00a0]/g, "");
              const firstBlock = candidates.find(
                (candidate) =>
                  normalizeText(candidate.textContent ?? "") ===
                  values.firstLine,
              );
              const secondBlock = candidates.find(
                (candidate) =>
                  normalizeText(candidate.textContent ?? "") ===
                  values.secondLine,
              );
              const block =
                secondBlock ??
                element?.closest<HTMLElement>(blockSelector) ??
                root;
              const localText = normalizeText(block.textContent ?? "");
              return {
                focused: document.activeElement === root,
                collapsed: selection?.isCollapsed ?? false,
                blockTag: block?.tagName ?? root.tagName,
                blockTextLength: localText.length,
                blockTailMatches: localText.endsWith(values.secondLine),
                separateBlocks:
                  !!firstBlock && !!secondBlock && firstBlock !== secondBlock,
                sameBlockTag:
                  !!firstBlock &&
                  !!secondBlock &&
                  firstBlock.tagName === secondBlock.tagName,
                firstBlockFound: !!firstBlock,
                blockCandidates: candidates.map((candidate) => ({
                  tag: candidate.tagName,
                  textLength: normalizeText(candidate.textContent ?? "").length,
                  isRoot: candidate === root,
                  parent: candidate.parentElement?.tagName ?? null,
                })),
                x: rect?.x ?? null,
                y: rect?.y ?? null,
                height: rect?.height ?? 0,
              };
            },
            { firstLine, secondLine },
          );
          const lineStart =
            before.start - firstLine.length - secondLine.length + 1;
          if (
            !before.inside ||
            !before.collapsed ||
            !beforeRect.blockTailMatches ||
            !beforeRect.separateBlocks ||
            !beforeRect.sameBlockTag ||
            !beforeRect.firstBlockFound ||
            before.start !==
              lineStart + firstLine.length + secondLine.length - 1 ||
            !beforeRect.focused ||
            !beforeRect.collapsed ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            beforeRect.height <= 0
          ) {
            throw new Error(
              `vertical-navigation setup did not reach the second line end (${JSON.stringify({ inside: before.inside, collapsed: before.collapsed, offset: before.start, lineStart, geometry: beforeRect })})`,
            );
          }
          await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringVerticalKeyProbe?: {
                root: HTMLElement;
                events: Array<{
                  key: string;
                  trusted: boolean;
                  inside: boolean;
                }>;
                listener: (event: KeyboardEvent) => void;
              };
            };
            const events: Array<{
              key: string;
              trusted: boolean;
              inside: boolean;
            }> = [];
            const listener = (event: KeyboardEvent) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              events.push({
                key: event.key,
                trusted: event.isTrusted,
                inside:
                  event.target === root || root.contains(event.target as Node),
              });
            };
            root.addEventListener("keydown", listener, true);
            scope.__authoringVerticalKeyProbe = { root, events, listener };
          });
          await editor.press("ArrowUp");
          const up = await inspectSelection();
          const upRect = await editor.evaluate(() => {
            const range = window.getSelection()?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            return { x: rect?.x ?? null, y: rect?.y ?? null };
          });
          const upBlockMatchesFirst = await editor.evaluate(
            (root: HTMLElement, expected: string) => {
              const anchor = window.getSelection()?.anchorNode;
              const element =
                anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
              const block = element?.closest<HTMLElement>(
                "p,div,h1,h2,h3,h4,h5,h6,blockquote,li,pre",
              );
              return (
                block?.textContent?.replaceAll(/[\u200b\ufeff\u00a0]/g, "") ===
                  expected && root.contains(block)
              );
            },
            firstLine,
          );
          if (
            !up.inside ||
            !up.collapsed ||
            !upBlockMatchesFirst ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            upRect.x === null ||
            upRect.y === null ||
            Math.abs(beforeRect.x - upRect.x) > 4 ||
            upRect.y >= beforeRect.y
          ) {
            throw new Error(
              `ArrowUp did not preserve the caret column (${before.start} at ${beforeRect.x},${beforeRect.y} to ${up.start} at ${upRect.x},${upRect.y}; in first block=${upBlockMatchesFirst})`,
            );
          }
          await editor.press("ArrowDown");
          const down = await inspectSelection();
          const downRect = await editor.evaluate(() => {
            const range = window.getSelection()?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            return { x: rect?.x ?? null, y: rect?.y ?? null };
          });
          const keyEvents = await editor.evaluate((root: HTMLElement) => {
            const scope = window as Window & {
              __authoringVerticalKeyProbe?: {
                root: HTMLElement;
                events: Array<{
                  key: string;
                  trusted: boolean;
                  inside: boolean;
                }>;
                listener: (event: KeyboardEvent) => void;
              };
            };
            const probe = scope.__authoringVerticalKeyProbe;
            if (!probe || probe.root !== root) return [];
            root.removeEventListener("keydown", probe.listener, true);
            delete scope.__authoringVerticalKeyProbe;
            return probe.events;
          });
          if (
            !down.inside ||
            !down.collapsed ||
            down.start !== before.start ||
            beforeRect.x === null ||
            beforeRect.y === null ||
            downRect.x === null ||
            downRect.y === null ||
            Math.abs(beforeRect.x - downRect.x) > 4 ||
            Math.abs(beforeRect.y - downRect.y) > 4 ||
            keyEvents.length !== 2 ||
            keyEvents.some(
              (
                event: { key: string; trusted: boolean; inside: boolean },
                index: number,
              ) =>
                event.key !== (index === 0 ? "ArrowUp" : "ArrowDown") ||
                !event.trusted ||
                !event.inside,
            )
          ) {
            throw new Error(
              `ArrowDown did not return the caret (${before.start} at ${beforeRect.x},${beforeRect.y} to ${down.start} at ${downRect.x},${downRect.y}; events=${JSON.stringify(keyEvents)})`,
            );
          }
          break;
        }
        case "select-cross-block-type": {
          await makeCrossBlockSelection();
          await snapshotEditorSiblings("capture", operation);
          await typeText("R");
          break;
        }
        case "select-cross-block-delete": {
          await makeCrossBlockSelection();
          await snapshotEditorSiblings("capture", operation);
          const selected = await inspectSelection();
          const expected =
            selected.text.slice(0, selected.start) +
            selected.text.slice(selected.end);
          await editor.press("Backspace");
          const after = await inspectSelection();
          if (after.text !== expected || after.start !== selected.start) {
            throw new Error("cross-block deletion missed the selected range");
          }
          break;
        }
        case "bold":
          await page.keyboard.press(`${modifier}+B`);
          await typeText("b");
          break;
        case "italic":
          await page.keyboard.press(`${modifier}+I`);
          await typeText("i");
          break;
        case "underline":
          await page.keyboard.press(`${modifier}+U`);
          await typeText("u");
          break;
        case "strike-shortcut":
          await page.keyboard.press(`${modifier}+Shift+S`);
          await typeText("s");
          break;
        case "code-shortcut": {
          const before = await inspectSelection();
          await page.keyboard.press(`${modifier}+E`);
          const state = await editor.evaluate((root: HTMLElement) => {
            const selection = window.getSelection();
            const anchor = selection?.anchorNode;
            return {
              focused: document.activeElement === root,
              inside: !!anchor && root.contains(anchor),
            };
          });
          const after = await inspectSelection();
          if (
            !state.focused ||
            !state.inside ||
            after.collapsed !== before.collapsed ||
            after.text !== before.text ||
            after.start !== before.start ||
            after.end !== before.end
          ) {
            throw new Error(
              `code shortcut moved the selection (${JSON.stringify({ before, after, state })})`,
            );
          }
          await typeText("c");
          break;
        }
        case "copy-inline": {
          await newLine();
          const token = `copymark${activeIndex}`;
          await typeText(token);
          await selectToken(token);
          await page.keyboard.press(`${modifier}+B`);
          const selectedWeight = await editor.evaluate((root: HTMLElement) => {
            const selection = window.getSelection();
            const node = selection?.anchorNode;
            const element =
              node instanceof Element ? node : node?.parentElement;
            return element && root.contains(element)
              ? getComputedStyle(element).fontWeight
              : null;
          });
          const numericWeight =
            selectedWeight === "bold" || selectedWeight === "bolder"
              ? 700
              : Number.parseInt(selectedWeight ?? "400", 10);
          if (numericWeight < 600) {
            await page.keyboard.press(`${modifier}+B`);
          }
          const finalSelectedWeight = await editor.evaluate(
            (root: HTMLElement) => {
              const selection = window.getSelection();
              const node = selection?.anchorNode;
              const element =
                node instanceof Element ? node : node?.parentElement;
              return element && root.contains(element)
                ? getComputedStyle(element).fontWeight
                : null;
            },
          );
          const copied = await copySelection();
          const copiedBold = await editor.evaluate(
            (_root: HTMLElement, html: string) => {
              const document = new DOMParser().parseFromString(
                html,
                "text/html",
              );
              return Array.from(
                document.querySelectorAll<HTMLElement>(
                  "strong,b,span[style*='font-weight']",
                ),
              ).some((mark) => {
                const weight = mark.style.fontWeight.trim();
                if (/^(?:normal|400)$/i.test(weight)) return false;
                return (
                  mark.matches("strong,b") ||
                  weight === "bold" ||
                  Number.parseInt(weight, 10) >= 600
                );
              });
            },
            copied.html,
          );
          if (!copiedBold) {
            const copyState = await editor.evaluate((root: HTMLElement) => {
              const selection = window.getSelection();
              const range = selection?.rangeCount
                ? selection.getRangeAt(0)
                : null;
              const holder = document.createElement("div");
              if (range) holder.append(range.cloneContents());
              const selectedText = range?.toString() ?? "";
              const selectedNodes: Array<{
                text: string;
                weight: string | null;
                markup: string | null;
              }> = [];
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                if (!range?.intersectsNode(node)) continue;
                const element = node.parentElement;
                selectedNodes.push({
                  text: node.textContent ?? "",
                  weight: element ? getComputedStyle(element).fontWeight : null,
                  markup: element?.outerHTML ?? null,
                });
              }
              return {
                selectedText,
                selectedHtml: holder.innerHTML,
                selectedNodes,
              };
            });
            throw new Error(
              `copy did not preserve the selected bold mark (${JSON.stringify({ selectedWeight, finalSelectedWeight, html: copied.html, copyState })})`,
            );
          }
          if (!copied.slideClipboard) {
            throw new Error("copy did not preserve the slide clipboard marker");
          }
          await newPlainLine();
          await paste(copied.html, copied.text, copied.slideClipboard);
          const pastedMark = await editor.evaluate(
            (root: HTMLElement, value: string) => {
              const mark = Array.from(
                root.querySelectorAll<HTMLElement>(
                  "strong,b,span[style*='font-weight']",
                ),
              ).find((candidate) =>
                (candidate.textContent ?? "")
                  .replaceAll("\u200b", "")
                  .replaceAll("\u00a0", " ")
                  .includes(value),
              );
              return {
                preserved:
                  !!mark &&
                  (mark.matches("strong,b") ||
                    Number.parseInt(getComputedStyle(mark).fontWeight, 10) >=
                      600),
                tag: mark?.tagName ?? null,
                textLength: mark?.textContent?.length ?? 0,
                fontWeight: mark ? getComputedStyle(mark).fontWeight : null,
                html: mark?.outerHTML ?? null,
                tokenIncluded:
                  mark?.textContent
                    ?.replaceAll("\u200b", "")
                    .replaceAll("\u00a0", " ")
                    .includes(value) ?? false,
              };
            },
            token,
          );
          if (!pastedMark.preserved) {
            throw new Error(
              `pasting copied rich text lost its bold mark (${JSON.stringify({ pastedMark, copiedHtml: copied.html, slideClipboard: copied.slideClipboard })})`,
            );
          }
          break;
        }
        case "replacement":
          await dispatchReplacement();
          break;
        case "undo":
          await page.keyboard.press(`${modifier}+Z`);
          break;
        case "redo":
          await page.keyboard.press(`${modifier}+Shift+Z`);
          break;
      }

      tracePhase("operation:end");
      tracePhase("caret-check:start");
      await assertCaret();
      tracePhase("caret-check:end");
      tracePhase("page-errors:start");
      await checkPageErrors();
      tracePhase("page-errors:end");
      tracePhase("sibling-assert:start");
      const siblingChanges = await snapshotEditorSiblings("assert", operation);
      tracePhase("sibling-assert:end");
      if (
        siblingChanges.length &&
        !skipFinalSiblingCheck &&
        !["undo", "redo", "shortcut-undo", "slash-undo"].includes(
          operation.kind,
        )
      ) {
        throw new Error(
          "sibling block inside the editor moved or restyled: " +
            siblingChanges.slice(0, 5).join(", "),
        );
      }
      tracePhase("outside-assert:start");
      await assertOutsideUnchanged();
      tracePhase("outside-assert:end");
      if ((activeIndex + 1) % 100 === 0) {
        console.log(
          `[edit-fidelity] fuzz seed=${seed} checked ${activeIndex + 1}/${plan.length} steps`,
        );
      }
    }

    const finalHtml = await editor.innerHTML();
    const finalSlideHtml = await slideContent.innerHTML();
    const readHistoryState = () =>
      page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        const selection = window.getSelection();
        const historyStats =
          root instanceof HTMLElement
            ? ((
                root as HTMLElement & {
                  __slidesInPlaceTextHistoryStats?: Record<string, unknown>;
                }
              ).__slidesInPlaceTextHistoryStats ?? null)
            : null;
        return {
          html: root instanceof HTMLElement ? root.innerHTML : null,
          historyStats,
          inside:
            root instanceof HTMLElement &&
            !!selection?.rangeCount &&
            root.contains(selection.anchorNode) &&
            root.contains(selection.focusNode),
        };
      }, editorSelector);
    const historyDepthFromStats = (
      stats: Record<string, unknown> | null,
      direction: "undo" | "redo",
    ) => {
      const depth = stats?.[direction === "undo" ? "undoDepth" : "redoDepth"];
      if (
        typeof depth !== "number" ||
        !Number.isSafeInteger(depth) ||
        depth < 0
      ) {
        throw new Error(
          `${direction} history depth is unavailable during replay`,
        );
      }
      return depth;
    };
    // Keep one real shortcut per direction; replay the rest in-page to avoid thousands of protocol round trips.
    const historyReplayYieldBudgetMs = 50;
    const runHistoryBatch = (options: {
      direction: "undo" | "redo";
      maxCalls: number;
      stableCalls: number;
    }) =>
      page.evaluate(
        async ({
          selector,
          modifier,
          stableLimit,
          yieldBudgetMs,
          ...state
        }: {
          selector: string;
          modifier: string;
          stableLimit: number;
          yieldBudgetMs: number;
          direction: "undo" | "redo";
          maxCalls: number;
          stableCalls: number;
        }) => {
          let { stableCalls } = state;
          let calls = 0;
          let maxSliceDurationMs = 0;
          let maxEventDurationMs = 0;
          let sliceStartedAt = performance.now();
          const historyDepth = (root: HTMLElement) => {
            const stats = (
              root as HTMLElement & {
                __slidesInPlaceTextHistoryStats?: Record<string, unknown>;
              }
            ).__slidesInPlaceTextHistoryStats;
            const depth =
              stats?.[state.direction === "undo" ? "undoDepth" : "redoDepth"];
            if (
              typeof depth !== "number" ||
              !Number.isSafeInteger(depth) ||
              depth < 0
            ) {
              throw new Error(
                `${state.direction} history depth is unavailable during replay`,
              );
            }
            return depth;
          };
          while (calls < state.maxCalls && stableCalls < stableLimit) {
            const eventStartedAt = performance.now();
            const root = document.querySelector(selector);
            if (!(root instanceof HTMLElement)) {
              throw new Error(
                "edited element disappeared during history replay",
              );
            }
            const previousDepth = historyDepth(root);
            const event = new KeyboardEvent("keydown", {
              key: "z",
              code: "KeyZ",
              bubbles: true,
              cancelable: true,
              metaKey: modifier === "Meta",
              ctrlKey: modifier === "Control",
              shiftKey: state.direction === "redo",
            });
            if (root.dispatchEvent(event)) {
              throw new Error(
                `the editor did not handle ${state.direction} during history replay`,
              );
            }
            const restored = document.querySelector(selector);
            if (!(restored instanceof HTMLElement)) {
              throw new Error(
                "edited element disappeared during history replay",
              );
            }
            const selection = window.getSelection();
            if (
              !selection?.rangeCount ||
              !restored.contains(selection.anchorNode) ||
              !restored.contains(selection.focusNode)
            ) {
              throw new Error(
                `selection/caret left the edited element during ${state.direction}`,
              );
            }
            const nextDepth = historyDepth(restored);
            if (nextDepth > previousDepth) {
              throw new Error(
                `${state.direction} history depth increased during replay`,
              );
            }
            if (nextDepth === previousDepth) stableCalls += 1;
            else {
              stableCalls = 0;
            }
            calls += 1;
            const eventDurationMs = performance.now() - eventStartedAt;
            maxEventDurationMs = Math.max(maxEventDurationMs, eventDurationMs);
            const sliceDurationMs = performance.now() - sliceStartedAt;
            maxSliceDurationMs = Math.max(maxSliceDurationMs, sliceDurationMs);
            if (sliceDurationMs >= yieldBudgetMs) {
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, 0),
              );
              sliceStartedAt = performance.now();
            }
          }
          const root = document.querySelector(selector);
          if (!(root instanceof HTMLElement)) {
            throw new Error("edited element disappeared during history replay");
          }
          return {
            html: root.innerHTML,
            historyDepth: historyDepth(root),
            stableCalls,
            calls,
            maxSliceDurationMs,
            maxEventDurationMs,
          };
        },
        {
          ...options,
          selector: editorSelector,
          modifier,
          stableLimit: stableHistoryProbeLimit,
          yieldBudgetMs: historyReplayYieldBudgetMs,
        },
      );
    let currentHtml = finalHtml;
    activePhase = "undo-all";
    // Drain selection-only snapshots too, past the editor's configured cap.
    const stableHistoryProbeLimit = 3;
    const maxHistoryCalls = historyLimit + stableHistoryProbeLimit;
    const beforeKeyboardUndo = await readHistoryState();
    const historyStats = requireUndoHistoryStats(
      beforeKeyboardUndo.historyStats,
    );
    const undoDepthBefore = historyDepthFromStats(historyStats, "undo");
    let stableUndo = 0;
    let undoCalls = 0;
    await page.keyboard.press(`${modifier}+Z`);
    undoCalls += 1;
    const afterKeyboardUndo = await readHistoryState();
    if (!afterKeyboardUndo.inside) {
      throw new Error("selection/caret left the edited element during undo");
    }
    if (afterKeyboardUndo.html === null)
      throw new Error("edited element disappeared during undo");
    const undoDepthAfterKeyboard = historyDepthFromStats(
      afterKeyboardUndo.historyStats,
      "undo",
    );
    if (undoDepthAfterKeyboard > undoDepthBefore) {
      throw new Error("undo history depth increased during replay");
    }
    const undoCount = undoDepthBefore;
    if (undoDepthAfterKeyboard === undoDepthBefore) stableUndo += 1;
    currentHtml = afterKeyboardUndo.html;
    const remainingUndo = await runHistoryBatch({
      direction: "undo",
      maxCalls: maxHistoryCalls - undoCalls,
      stableCalls: stableUndo,
    });
    undoCalls += remainingUndo.calls;
    currentHtml = remainingUndo.html;
    if (remainingUndo.historyDepth !== 0) {
      throw new Error(
        `undo history still has ${remainingUndo.historyDepth} state(s) after replay`,
      );
    }
    console.log(
      `[edit-fidelity] undo history replay: ${remainingUndo.calls} calls; max event ${remainingUndo.maxEventDurationMs.toFixed(1)}ms; max synchronous slice ${remainingUndo.maxSliceDurationMs.toFixed(1)}ms`,
    );
    await checkPageErrors();
    await assertOutsideUnchanged();
    assertByteIdenticalHtml(
      currentHtml,
      originalHtml,
      `undo-all editor HTML after ${undoCalls} undo keypress(es)`,
    );
    assertByteIdenticalHtml(
      await withoutSessionAttributes(await slideContent.innerHTML()),
      originalSlideHtml,
      `undo-all slide HTML after ${undoCalls} undo keypress(es)`,
    );

    const beforeKeyboardRedo = await readHistoryState();
    const redoDepthBefore = historyDepthFromStats(
      beforeKeyboardRedo.historyStats,
      "redo",
    );
    let stableRedo = 0;
    let redoCalls = 0;
    activePhase = "redo-all";
    const maxRedoCalls = historyLimit + stableHistoryProbeLimit;
    await page.keyboard.press(`${modifier}+Shift+Z`);
    redoCalls += 1;
    const afterKeyboardRedo = await readHistoryState();
    if (!afterKeyboardRedo.inside) {
      throw new Error("selection/caret left the edited element during redo");
    }
    if (afterKeyboardRedo.html === null)
      throw new Error("edited element disappeared during redo");
    const redoDepthAfterKeyboard = historyDepthFromStats(
      afterKeyboardRedo.historyStats,
      "redo",
    );
    if (redoDepthAfterKeyboard > redoDepthBefore) {
      throw new Error("redo history depth increased during replay");
    }
    const redoCount = redoDepthBefore;
    if (redoDepthAfterKeyboard === redoDepthBefore) stableRedo += 1;
    currentHtml = afterKeyboardRedo.html;
    const remainingRedo = await runHistoryBatch({
      direction: "redo",
      maxCalls: maxRedoCalls - redoCalls,
      stableCalls: stableRedo,
    });
    redoCalls += remainingRedo.calls;
    currentHtml = remainingRedo.html;
    if (remainingRedo.historyDepth !== 0) {
      throw new Error(
        `redo history still has ${remainingRedo.historyDepth} state(s) after replay`,
      );
    }
    console.log(
      `[edit-fidelity] redo history replay: ${remainingRedo.calls} calls; max event ${remainingRedo.maxEventDurationMs.toFixed(1)}ms; max synchronous slice ${remainingRedo.maxSliceDurationMs.toFixed(1)}ms`,
    );
    await checkPageErrors();
    await assertOutsideUnchanged();
    assertByteIdenticalHtml(currentHtml, finalHtml, "redo-all editor HTML");
    assertByteIdenticalHtml(
      await slideContent.innerHTML(),
      finalSlideHtml,
      `redo-all slide HTML after ${redoCalls} redo keypress(es)`,
    );

    activePhase = "save/reload";
    const persistence = await options.finishAndReload(() => {
      browserSessionIdAtReload = currentBrowserSessionId;
      reloadNavigationStartedAt = Date.now();
      lastReloadStartedAt = reloadNavigationStartedAt;
      outgoingDocumentUrlAtReload = page.url();
      mainFrameNavigationStartedAt = null;
      mainFrameNavigationRequestSequence = null;
      mainFrameNavigationCommittedAt = null;
      retiredSessionErrorCorrelator.beginNavigation(
        browserSessionIdAtReload,
        authoringPageOrigin,
        reloadNavigationStartedAt,
      );
      for (const [request, startedAt] of watchedRequests.entries()) {
        const requestFrame =
          request.serviceWorker() === null ? request.frame() : null;
        const requestUrl = new URL(request.url());
        const sessionIdentity = browserSessionNavigationRequestIdentity(
          request.method(),
          requestUrl.pathname,
          request.postData(),
        );
        const identifiedSession =
          sessionIdentity?.status === "identified" ? sessionIdentity : null;
        reloadNavigationRequests.set(request, {
          startedAt,
          settledAt: null,
          finishedSuccessfully: false,
          responseStatus:
            inFlightBrowserSessionClaims.get(request)?.responseStatus ?? null,
          requestWasPendingAtNavigation: true,
          completedSuccessfullyBeforeNavigation: false,
          completedBeforeNavigationAgeMs: null,
          requestStartedDuringNavigation: false,
          requestStartedAfterNavigation: false,
          requestSequence: 0,
          resourceType: request.resourceType(),
          requestSourceIsMainFrame: requestFrame === page.mainFrame(),
          requestFrameUrl: requestFrame ? requestFrame.url() : null,
          outgoingDocumentUrl: outgoingDocumentUrlAtReload,
          outgoingRequestKind: identifiedSession?.kind ?? null,
          requestSessionId: identifiedSession?.sessionId ?? null,
          mainFrameNavigationStartedAt: null,
          mainFrameNavigationRequestSequence: null,
          requestStartedBeforeMainFrameCommit: false,
          requestStartedBeforeReloadCommit: false,
          retiredSessionId: browserSessionIdAtReload,
          failureAt: null,
          failureText: null,
          pendingOutgoingAbort: false,
          outgoingNavigationAbort: false,
        });
        if (traceEnabled) {
          console.log(
            `[edit-fidelity] reload pending ${request.method()} ${new URL(request.url()).pathname} ageMs=${Date.now() - startedAt}`,
          );
        }
      }
      for (const [request, claim] of recentlyCompletedBrowserSessionClaims) {
        const completedBeforeNavigationAgeMs =
          reloadNavigationStartedAt - claim.settledAt;
        if (
          completedBeforeNavigationAgeMs < 0 ||
          completedBeforeNavigationAgeMs >=
            reloadNavigationSuccessfulClaimGraceMs
        ) {
          continue;
        }
        reloadNavigationRequests.set(request, {
          startedAt: claim.startedAt,
          settledAt: claim.settledAt,
          finishedSuccessfully: true,
          responseStatus: claim.responseStatus,
          requestWasPendingAtNavigation: false,
          completedSuccessfullyBeforeNavigation: true,
          completedBeforeNavigationAgeMs,
          requestStartedDuringNavigation: false,
          requestStartedAfterNavigation: false,
          requestSequence: 0,
          resourceType: request.resourceType(),
          requestSourceIsMainFrame: false,
          requestFrameUrl: null,
          outgoingDocumentUrl: outgoingDocumentUrlAtReload,
          outgoingRequestKind: null,
          requestSessionId: null,
          mainFrameNavigationStartedAt: null,
          mainFrameNavigationRequestSequence: null,
          requestStartedBeforeMainFrameCommit: false,
          requestStartedBeforeReloadCommit: false,
          retiredSessionId: browserSessionIdAtReload,
          failureAt: null,
          failureText: null,
          pendingOutgoingAbort: false,
          outgoingNavigationAbort: false,
        });
      }
      recentlyCompletedBrowserSessionClaims.clear();
    });
    const retiredSessionGraceWaitMs =
      retiredSessionErrorCorrelator.finishNavigation(Date.now());
    if (retiredSessionGraceWaitMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, retiredSessionGraceWaitMs),
      );
    }
    assertAuthoringPersistence(persistence);
    await checkPageErrors();
    pageErrors.push(...retiredSessionErrorCorrelator.clear());
    reloadNavigationStartedAt = null;
    browserSessionIdAtReload = null;
    await checkPageErrors();
    const unexpectedConflictPaths = [
      ...new Set(
        conflictResponsePaths.filter(
          (responsePath) => responsePath !== patchDeckActionPath,
        ),
      ),
    ];
    if (
      conflictResourceErrors > patchDeckConflicts ||
      unexpectedConflictPaths.length > 0
    ) {
      throw new Error(
        `a 409 resource error did not match a patch-deck conflict response (${conflictResourceErrors} console error(s), ${patchDeckConflicts} patch-deck response(s); paths: ${conflictResponsePaths.length ? [...new Set(conflictResponsePaths)].join(", ") : "none captured"})`,
      );
    }
    if (patchDeckConflicts > 0) {
      console.log(
        `[edit-fidelity] recovered ${patchDeckConflicts} patch-deck conflict response(s); saved and reloaded HTML matched the live slide`,
      );
    }
    return {
      seed,
      stepsRun: plan.length,
      stepLog: plan,
      undoSteps: undoCount,
      redoSteps: redoCount,
    };
  } catch (error) {
    const deferredOutgoingAbortErrors = finalizePendingOutgoingAborts();
    clearOutgoingAbortTimers();
    const unavailableError = getHarnessUnavailableError(error);
    if (unavailableError) {
      if (!deferredOutgoingAbortErrors.length) throw unavailableError;
      throw new CouldNotRun(
        `${unavailableError.message}\ndeferred outgoing request failure(s): ${deferredOutgoingAbortErrors.join("; ")}`,
      );
    }
    const prefix = replay();
    let diagnostics:
      | { status: "available"; value: Record<string, unknown> }
      | { status: "unavailable"; error: string };
    try {
      const value = await page.evaluate((selector: string) => {
        const root = document.querySelector(selector);
        const scope = window as Window & {
          __slidesAuthoringInputTrace?: Array<Record<string, unknown>>;
        };
        const selection = window.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement =
          anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
        const block = anchorElement?.closest<HTMLElement>(
          "p,div,li,blockquote,h1,h2,h3,h4,h5,h6,pre",
        );
        let prefix = "";
        if (block && anchor && selection?.rangeCount) {
          try {
            const range = document.createRange();
            range.selectNodeContents(block);
            range.setEnd(anchor, selection.anchorOffset);
            prefix = range
              .toString()
              .replaceAll(String.fromCharCode(0x200b), "");
          } catch {
            prefix = "";
          }
        }
        const controls =
          root instanceof HTMLElement
            ? root.getAttribute("aria-controls")
            : null;
        const listboxes = Array.from(
          document.querySelectorAll<HTMLElement>('[role="listbox"]'),
        );
        const listbox = controls ? document.getElementById(controls) : null;
        const listboxStyle = listbox ? getComputedStyle(listbox) : null;
        const firstOption =
          listbox?.querySelector<HTMLElement>('[role="option"]');
        let firstOptionSnapshot: Record<string, unknown> | null = null;
        if (firstOption) {
          const style = getComputedStyle(firstOption);
          const rect = firstOption.getBoundingClientRect();
          const clientRectCount = firstOption.getClientRects().length;
          const hiddenAncestorFlags = {
            hiddenAttribute: false,
            ariaHidden: false,
            displayNone: false,
            visibilityHidden: false,
            opacityZero: false,
            hiddenClass: false,
            invisibleClass: false,
            opacityZeroClass: false,
          };
          let ancestor = firstOption.parentElement;
          let ancestorCount = 0;
          while (ancestor && ancestorCount < 12) {
            const ancestorStyle = getComputedStyle(ancestor);
            hiddenAncestorFlags.hiddenAttribute ||=
              ancestor.hasAttribute("hidden");
            hiddenAncestorFlags.ariaHidden ||=
              ancestor.getAttribute("aria-hidden") === "true";
            hiddenAncestorFlags.displayNone ||=
              ancestorStyle.display === "none";
            hiddenAncestorFlags.visibilityHidden ||=
              ancestorStyle.visibility === "hidden" ||
              ancestorStyle.visibility === "collapse";
            hiddenAncestorFlags.opacityZero ||= ancestorStyle.opacity === "0";
            hiddenAncestorFlags.hiddenClass ||=
              ancestor.classList.contains("hidden");
            hiddenAncestorFlags.invisibleClass ||=
              ancestor.classList.contains("invisible");
            hiddenAncestorFlags.opacityZeroClass ||=
              ancestor.classList.contains("opacity-0");
            ancestor = ancestor.parentElement;
            ancestorCount += 1;
          }
          firstOptionSnapshot = {
            exists: true,
            hasNonzeroBox: rect.width > 0 && rect.height > 0,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            classFlags: {
              hidden: firstOption.classList.contains("hidden"),
              invisible: firstOption.classList.contains("invisible"),
              opacityZero: firstOption.classList.contains("opacity-0"),
            },
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            clientRectCount,
            hiddenAncestorFlags,
            ancestorScanTruncated: ancestor !== null,
          };
        }
        return {
          historyStats:
            root instanceof HTMLElement
              ? ((
                  root as HTMLElement & {
                    __slidesInPlaceTextHistoryStats?: Record<string, unknown>;
                  }
                ).__slidesInPlaceTextHistoryStats ?? null)
              : null,
          focus: {
            rootFocused: document.activeElement === root,
            activeTag: document.activeElement?.tagName ?? null,
          },
          selection: {
            collapsed: selection?.isCollapsed ?? null,
            insideRoot:
              root instanceof HTMLElement &&
              !!anchor &&
              !!selection?.focusNode &&
              root.contains(anchor) &&
              root.contains(selection.focusNode),
            anchorType: anchor?.nodeType ?? null,
            anchorTag: anchorElement?.tagName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            blockTag: block?.tagName ?? null,
            blockLength: block?.textContent?.length ?? null,
            prefixLength: prefix.length,
            prefixEmpty: prefix.length === 0,
            prefixEndsInWhitespace: /\s$/.test(prefix),
            slashOffset: prefix.lastIndexOf("/"),
            caretRect: (() => {
              if (!selection?.rangeCount) return null;
              const rect = selection.getRangeAt(0).getBoundingClientRect();
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              };
            })(),
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
          },
          slashMenu: {
            count: listboxes.length,
            controlledId: controls,
            id: listbox?.id ?? null,
            dataState: listbox?.getAttribute("data-state") ?? null,
            visible:
              !!listbox &&
              listboxStyle?.visibility !== "hidden" &&
              listboxStyle?.display !== "none" &&
              listbox.getClientRects().length > 0,
            optionCount:
              listbox?.querySelectorAll('[role="option"]').length ?? 0,
            activeOption: (() => {
              const activeId =
                root instanceof HTMLElement
                  ? root.getAttribute("aria-activedescendant")
                  : null;
              const active = activeId
                ? document.getElementById(activeId)
                : null;
              const activeStyle = active ? getComputedStyle(active) : null;
              const activeRect = active?.getBoundingClientRect();
              return {
                id: activeId,
                exists: !!active,
                role: active?.getAttribute("role") ?? null,
                contained: !!(listbox && active && listbox.contains(active)),
                text: active?.textContent?.trim().slice(0, 100) ?? null,
                display: activeStyle?.display ?? null,
                visibility: activeStyle?.visibility ?? null,
                opacity: activeStyle?.opacity ?? null,
                clientRects: active?.getClientRects().length ?? 0,
                rect: activeRect
                  ? {
                      left: activeRect.left,
                      top: activeRect.top,
                      right: activeRect.right,
                      bottom: activeRect.bottom,
                      width: activeRect.width,
                      height: activeRect.height,
                    }
                  : null,
              };
            })(),
            options: Array.from(
              listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
            ).map((option) => {
              const style = getComputedStyle(option);
              const rect = option.getBoundingClientRect();
              return {
                id: option.id,
                text: option.textContent?.trim().slice(0, 100) ?? null,
                selected:
                  option.getAttribute("aria-selected") ??
                  option.getAttribute("data-selected"),
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                clientRects: option.getClientRects().length,
                rect: {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                },
              };
            }),
            listboxes: listboxes.map((menu) => {
              const style = getComputedStyle(menu);
              const rect = menu.getBoundingClientRect();
              return {
                id: menu.id,
                dataState: menu.getAttribute("data-state"),
                optionCount: menu.querySelectorAll('[role="option"]').length,
                visible:
                  style.visibility !== "hidden" &&
                  style.display !== "none" &&
                  menu.getClientRects().length > 0,
                rect: {
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                },
              };
            }),
            activeDescendant:
              root instanceof HTMLElement
                ? root.getAttribute("aria-activedescendant")
                : null,
            controls,
          },
          firstOption: firstOptionSnapshot,
          recentInputEvents:
            scope.__slidesAuthoringInputTrace?.slice(-12) ?? [],
        };
      }, editorSelector);
      diagnostics = { status: "available", value };
    } catch (diagnosticError) {
      diagnostics = { status: "unavailable", error: String(diagnosticError) };
    }
    throw formatAuthoringFuzzFailure(
      seed,
      activePhase,
      prefix,
      [
        String(error),
        ...(deferredOutgoingAbortErrors.length
          ? [
              `deferred outgoing request failure(s): ${deferredOutgoingAbortErrors.join("; ")}`,
            ]
          : []),
        `diagnostics: ${JSON.stringify(diagnostics)}`,
      ].join("\n"),
      options.browser,
    );
  } finally {
    if (traceWatchdog) clearInterval(traceWatchdog);
    let deferredOutgoingAbortErrors: string[] = [];
    try {
      deferredOutgoingAbortErrors = finalizePendingOutgoingAborts();
    } finally {
      clearOutgoingAbortTimers();
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
      page.off("request", onRequest);
      page.off("requestfinished", onRequestSettled);
      page.off("requestfailed", onRequestFailed);
      page.off("framenavigated", onFrameNavigated);
    }
    if (deferredOutgoingAbortErrors.length) {
      throw new Error(
        `deferred outgoing request failure(s): ${deferredOutgoingAbortErrors.join("; ")}`,
      );
    }
  }
}
