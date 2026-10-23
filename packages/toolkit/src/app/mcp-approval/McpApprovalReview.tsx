import { useOptionalLocale } from "@agent-native/core/client/i18n";
import {
  describeFieldValue,
  fetchMcpApproval,
  formatApprovalTime,
  formatRequestedTime,
  formatWallTime,
  mcpApprovalMessagesForLocale,
  readMcpApprovalId,
  sendMcpApprovalDecision,
  type McpApprovalDecisionResult,
  type McpApprovalField,
  type McpApprovalMessages,
  type McpApprovalView,
  type McpApprovalViewState,
} from "@agent-native/core/client/mcp-approval";
import { useSession } from "@agent-native/core/client/use-session";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Button } from "@agent-native/toolkit/ui/button";
import { Card, CardContent, CardFooter } from "@agent-native/toolkit/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconAlertTriangle,
  IconBan,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClockOff,
  type Icon,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { AgentNativeIcon } from "../shared/AgentNativeIcon.js";

type TimeStyle = "time" | "date-time" | "date";

type Loaded =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "signed-out" }
  | { status: "sign-in-unavailable" }
  | { status: "not-found"; otherOrganization: boolean }
  | { status: "ready"; view: McpApprovalView };

/** Why the last decision didn't land, in the page's own words. */
type DecisionProblem =
  | "saveFailed"
  | "pageOutOfDate"
  | "signInToReview"
  | "signInUnavailable";

const UNDECIDABLE: Record<
  Exclude<McpApprovalDecisionResult["status"], "decided" | "not-found">,
  DecisionProblem
> = {
  "out-of-date": "pageOutOfDate",
  "signed-out": "signInToReview",
  "sign-in-unavailable": "signInUnavailable",
};

// A review link can be framed by any site that has it, and the app's session
// cookie can reach a frame, so a decision is only taken in a top-level window,
// as the framework's own review page only renders in one.
function isTopLevelWindow(): boolean {
  return window.top === window.self;
}

function readApprovalIdFromLocation(): string | undefined {
  return isTopLevelWindow()
    ? readMcpApprovalId(window.location.hash)
    : undefined;
}

export interface McpApprovalReviewGateProps {
  appName: string;
  /** Wraps the review, e.g. in the app's session gate and theme sync. */
  wrap: (review: ReactNode) => ReactNode;
  children: ReactNode;
}

/**
 * Shows the review for the grant the URL fragment names in place of the app,
 * and the app once the reader leaves it.
 */
export function McpApprovalReviewGate({
  appName,
  wrap,
  children,
}: McpApprovalReviewGateProps) {
  const [id, setId] = useState(readApprovalIdFromLocation);

  useEffect(() => {
    const onHashChange = () => setId(readApprovalIdFromLocation());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!id) return <>{children}</>;
  const openApp = () => {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", pathname + search);
    setId(undefined);
  };
  return wrap(
    <McpApprovalReviewPage
      key={id}
      id={id}
      appName={appName}
      onOpenApp={openApp}
    />,
  );
}

export interface McpApprovalReviewPageProps {
  id: string;
  appName: string;
  onOpenApp: () => void;
}

/** One MCP approval review, in the app's theme. */
export function McpApprovalReviewPage({
  id,
  appName,
  onOpenApp,
}: McpApprovalReviewPageProps) {
  const appLocale = useOptionalLocale()?.locale;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: "loading" });
    fetchMcpApproval(id, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setLoaded(
          result.status === "ready"
            ? { status: "ready", view: withClientExpiry(result.view) }
            : result,
        );
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ status: "failed" });
      },
    );
    return () => controller.abort();
  }, [id, attempt]);

  // Focus lands on the page, not a button, so a stray Enter decides nothing;
  // and again once a decision takes the buttons away.
  const phase = loaded.status === "ready" ? loaded.view.state : loaded.status;
  useEffect(() => {
    if (phase !== "loading") mainRef.current?.focus();
  }, [phase]);

  const view = loaded.status === "ready" ? loaded.view : undefined;
  const messages = mcpApprovalMessagesForLocale(
    view?.locale ?? appLocale ?? "en-US",
  );
  useDocumentTitle(
    view
      ? messages.documentTitle.replace("{action}", view.summary.title)
      : undefined,
  );

  useEffect(() => {
    if (!view || (view.state !== "pending" && view.state !== "approved")) {
      return;
    }
    const timer = window.setTimeout(
      () =>
        setLoaded((current) =>
          current.status === "ready"
            ? { status: "ready", view: withClientExpiry(current.view) }
            : current,
        ),
      Math.max(0, view.expiresAt - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [view]);

  const decided = (state: McpApprovalViewState, expiresAt: number) =>
    setLoaded((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            view: withClientExpiry({ ...current.view, state, expiresAt }),
          }
        : current,
    );

  return (
    <ReviewFrame appName={appName} mainRef={mainRef}>
      {loaded.status === "loading" ? (
        <ReviewSkeleton />
      ) : loaded.status === "ready" ? (
        <Review
          id={id}
          view={loaded.view}
          appName={appName}
          messages={messages}
          onDecided={decided}
          onNotFound={() =>
            setLoaded({ status: "not-found", otherOrganization: false })
          }
          onOpenApp={onOpenApp}
        />
      ) : (
        <ReviewNotice
          loaded={loaded}
          appName={appName}
          messages={messages}
          onRetry={() => setAttempt((count) => count + 1)}
          onOpenApp={onOpenApp}
        />
      )}
    </ReviewFrame>
  );
}

/** Shown while the session and the review load: the same frame and card. */
export function McpApprovalReviewSkeleton({ appName }: { appName: string }) {
  return (
    <ReviewFrame appName={appName}>
      <ReviewSkeleton />
    </ReviewFrame>
  );
}

/** A live grant past its deadline reads as expired without a reload. */
function withClientExpiry(view: McpApprovalView): McpApprovalView {
  const live = view.state === "pending" || view.state === "approved";
  return live && view.expiresAt <= Date.now()
    ? { ...view, state: "expired", csrfToken: undefined }
    : view;
}

function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title === undefined) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function ReviewFrame({
  appName,
  mainRef,
  children,
}: {
  appName: string;
  mainRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10 sm:justify-center">
      <div className="mb-6 flex items-center gap-1.5 text-sm font-semibold">
        <AgentNativeIcon
          aria-hidden="true"
          className="h-3.5 w-6 text-primary"
        />
        {appName}
      </div>
      <main
        ref={mainRef}
        tabIndex={-1}
        className="w-full max-w-lg outline-none"
      >
        <Card className="border border-border">{children}</Card>
      </main>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex flex-col gap-2 p-6">
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-6 w-1/2" />
      </div>
      <CardContent className="flex flex-col gap-5">
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-24" />
      </CardFooter>
    </div>
  );
}

type FillKey = "client" | "email" | "app" | "action";

/** Fills `{client}`, `{email}`, `{app}` and `{action}`, and puts `time` where `{time}` was. */
function fill(
  message: string,
  values: Partial<Record<FillKey, string>>,
  time?: ReactNode,
): ReactNode {
  // One pass, so a value that reads like a placeholder stays as written.
  const text = (part: string) =>
    part.replace(
      /\{(client|email|app|action)\}/g,
      (token, key: FillKey) => values[key] ?? token,
    );
  // Split first, so a client named "{time}" stays a name.
  const [before, ...after] = message.split("{time}");
  if (time === undefined || after.length === 0) return text(message);
  return (
    <>
      {text(before ?? "")}
      {time}
      {text(after.join("{time}"))}
    </>
  );
}

/**
 * Who asks, and for what. Action titles are English in sentence case, and
 * only the English copy runs one into a sentence, so only there does its
 * first word lose its capital: "wants to create event", but "RSVP" stays.
 */
function RequestHeading({
  view,
  messages,
}: {
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const { title } = view.summary;
  const action = view.locale.startsWith("en")
    ? title.replace(/^\p{Lu}(?=\p{Ll}*(?:\s|$))/u, (first) =>
        first.toLowerCase(),
      )
    : title;
  return (
    <h1 className="text-xl font-semibold leading-snug text-balance [overflow-wrap:anywhere]">
      {view.requester
        ? fill(messages.clientWantsTo, {
            client: view.requester.name ?? messages.unnamedClient,
            action,
          })
        : fill(messages.agentWantsTo, { action })}
    </h1>
  );
}

// An address inside text: what `approval-summary.ts` reads as one, minus the
// quotes and brackets around it in JSON.
const ADDRESS_IN_TEXT = /[^\s@<>(),;:"'[\]{}]+@[^\s@<>(),;:"'[\]{}]+\.[\w-]+/g;

/**
 * `text` with each email address whole: a line may break after an address's
 * "@" and nowhere else in it, so one address never reads as two. The breaks
 * add no characters, so copying the text copies the addresses unchanged.
 */
function KeepAddresses({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(ADDRESS_IN_TEXT)) {
    const start = match.index;
    const domain = start + match[0].lastIndexOf("@") + 1;
    parts.push(
      text.slice(last, start),
      <span key={start} className="whitespace-nowrap">
        {text.slice(start, domain)}
      </span>,
      <wbr key={`${start}:break`} />,
      <span key={`${start}:domain`} className="whitespace-nowrap">
        {text.slice(domain, start + match[0].length)}
      </span>,
    );
    last = start + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function readerZone(view: McpApprovalView): string {
  return (
    view.readerTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

/**
 * `at` in the reader's zone; with the call's own `zone`, also the time as the
 * call wrote it when that zone reads differently (`formatRequestedTime`).
 */
function ApprovalTime({
  at,
  style,
  zone,
  view,
  messages,
}: {
  at: number;
  style: TimeStyle;
  zone?: string;
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const reader = readerZone(view);
  let text = formatApprovalTime(at, reader, view.locale, style);
  const requested =
    zone && formatRequestedTime(at, zone, reader, view.locale, style);
  if (requested) {
    text += ` (${messages.requestedAs.replace("{time}", requested)})`;
  }
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}

function FieldValue({
  field,
  view,
  messages,
}: {
  field: McpApprovalField;
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  if (field.time) {
    return (
      <ApprovalTime
        at={field.time.at}
        style="date-time"
        zone={field.time.zone}
        view={view}
        messages={messages}
      />
    );
  }
  if (field.wallTime) {
    return (
      <>
        {formatWallTime(field.wallTime.at, view.locale)} (
        {field.wallTime.zone === "calendar"
          ? messages.calendarTimeZone
          : messages.noTimeZone}
        )
      </>
    );
  }
  return <KeepAddresses text={describeFieldValue(field, view.locale)} />;
}

type DecidedState = Exclude<McpApprovalViewState, "pending">;

const OUTCOME_ICONS: Record<DecidedState, Icon> = {
  approved: IconCircleCheck,
  used: IconCircleCheck,
  denied: IconBan,
  closed: IconCircleX,
  expired: IconClockOff,
};

function Review({
  id,
  view,
  appName,
  messages,
  onDecided,
  onNotFound,
  onOpenApp,
}: {
  id: string;
  view: McpApprovalView;
  appName: string;
  messages: McpApprovalMessages;
  onDecided: (state: McpApprovalViewState, expiresAt: number) => void;
  onNotFound: () => void;
  onOpenApp: () => void;
}) {
  const [saving, setSaving] = useState<"approve" | "deny" | null>(null);
  const [problem, setProblem] = useState<DecisionProblem | null>(null);
  const { summary } = view;
  const pending = view.state === "pending";

  const decide = async (decision: "approve" | "deny") => {
    if (!view.csrfToken) return;
    setSaving(decision);
    setProblem(null);
    try {
      const result = await sendMcpApprovalDecision(
        id,
        decision,
        view.csrfToken,
      );
      if (result.status === "decided") {
        onDecided(result.state, result.expiresAt);
      } else if (result.status === "not-found") {
        onNotFound();
      } else {
        setProblem(UNDECIDABLE[result.status]);
      }
    } catch {
      setProblem("saveFailed");
    }
    setSaving(null);
  };

  // The token or session behind this page is gone: deciding again here would
  // fail the same way, so the buttons stay off until a reload.
  const stuck = problem !== null && problem !== "saveFailed";

  return (
    <>
      <div className="p-6">
        <RequestHeading view={view} messages={messages} />
      </div>
      <CardContent className="flex flex-col gap-5">
        {view.state !== "pending" ? (
          <Outcome state={view.state} view={view} messages={messages} />
        ) : (
          <>
            {view.priorRun ? (
              <Alert>
                <IconAlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>
                  {fill(
                    view.priorRun.status === "completed"
                      ? messages.priorCompleted
                      : messages.priorUnknown,
                    {},
                    <ApprovalTime
                      at={view.priorRun.at}
                      style="time"
                      view={view}
                      messages={messages}
                    />,
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {summary.cut ? (
              <Alert>
                <IconAlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>{messages.argumentsCut}</AlertDescription>
              </Alert>
            ) : null}
            <Recipients recipients={summary.recipients} messages={messages} />
            <Facts view={view} messages={messages} />
            <Details view={view} messages={messages} />
            <p className="text-sm text-muted-foreground">
              {fill(
                messages.decideBy,
                {},
                <ApprovalTime
                  at={view.expiresAt}
                  style="time"
                  view={view}
                  messages={messages}
                />,
              )}
            </p>
          </>
        )}
        <p
          role="status"
          className={cn(
            "text-sm",
            problem ? "text-destructive" : "text-muted-foreground",
            !problem && !saving && "sr-only",
          )}
        >
          {problem ? messages[problem] : saving ? messages.saving : ""}
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {pending ? (
          <>
            <Button
              variant="outline"
              disabled={saving !== null || stuck}
              onClick={() => void decide("deny")}
            >
              {saving === "deny" ? <Spinner aria-hidden="true" /> : null}
              {messages.deny}
            </Button>
            {/* The chat's approval card's Approve: a theme's primary can be a
                mid gray in dark mode, which reads as disabled. */}
            <Button
              className="bg-foreground text-background hover:bg-foreground/90"
              disabled={saving !== null || stuck}
              onClick={() => void decide("approve")}
            >
              {saving === "approve" ? <Spinner aria-hidden="true" /> : null}
              {messages.approve}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onOpenApp}>
            {fill(messages.openApp, { app: appName })}
          </Button>
        )}
      </CardFooter>
    </>
  );
}

function Outcome({
  state,
  view,
  messages,
}: {
  state: DecidedState;
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const Icon = OUTCOME_ICONS[state];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          state === "approved" || state === "used"
            ? "text-primary"
            : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-medium leading-relaxed">
          {fill(
            messages[state],
            {},
            <ApprovalTime
              at={view.expiresAt}
              style="time"
              view={view}
              messages={messages}
            />,
          )}
        </p>
        <RequestLine view={view} messages={messages} />
      </div>
    </div>
  );
}

const REQUEST_LINE_MAX = 80;

/**
 * The request in one line, from its first short text and its first time, so
 * a reader with several reviews open knows which this one was. A grant keeps
 * its arguments only while it can still run, so a final one has none.
 */
function RequestLine({
  view,
  messages,
}: {
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const { fields } = view.summary;
  const named = fields.find(
    (field) =>
      !field.time &&
      !field.wallTime &&
      field.choice === undefined &&
      field.timeZone === undefined &&
      field.value !== messages.yes &&
      field.value !== messages.no &&
      field.value.length <= REQUEST_LINE_MAX &&
      !field.value.includes("\n"),
  );
  const timed = fields.find((field) => field.time || field.wallTime);
  if (!named && !timed) return null;
  return (
    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
      {named ? <KeepAddresses text={named.value} /> : null}
      {named && timed ? " · " : null}
      {timed?.time ? (
        <ApprovalTime
          at={timed.time.at}
          style="date-time"
          view={view}
          messages={messages}
        />
      ) : timed?.wallTime ? (
        formatWallTime(timed.wallTime.at, view.locale)
      ) : null}
    </p>
  );
}

// A sans font's widest average glyph, with room to spare, and the smallest
// size an address is still easy to read at.
const ADDRESS_EM_PER_CHAR = 0.6;
const ADDRESS_MIN_PX = 11;

function Recipients({
  recipients,
  messages,
}: {
  recipients: string[];
  messages: McpApprovalMessages;
}) {
  if (recipients.length === 0) return null;
  // An address breaks only after its "@", so the longest name (or domain)
  // has to fit on one line: the list's text shrinks until it does, and only
  // a name too long even at the floor scrolls.
  const longest = Math.max(
    ...recipients.flatMap((email) => {
      const domain = email.lastIndexOf("@") + 1;
      return [domain, email.length - domain];
    }),
  );
  const fit = `min(1em, max(${ADDRESS_MIN_PX}px, calc(100cqi / ${(
    longest * ADDRESS_EM_PER_CHAR
  ).toFixed(2)})))`;
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-xs font-medium text-muted-foreground">
        {messages.reaches}
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {recipients.map((email) => (
          <li key={email} className="flex min-w-0 items-center gap-2.5">
            <Avatar className="hidden size-7 shrink-0 sm:flex">
              <AvatarFallback className="text-xs">
                {email.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="@container min-w-0 flex-1 text-sm font-medium sm:text-base">
              <span className="block overflow-x-auto" style={{ fontSize: fit }}>
                <KeepAddresses text={email} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({
  view,
  messages,
}: {
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const { summary } = view;
  // The heading names the client; this says when the reader connected it.
  const connectedAt = view.requester?.connectedAt ?? null;
  if (connectedAt === null && summary.fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1.5">
      {connectedAt !== null ? (
        <Fact label={messages.connected}>
          <ApprovalTime
            at={connectedAt}
            style="date"
            view={view}
            messages={messages}
          />
        </Fact>
      ) : null}
      {summary.fields.map((field, index) => (
        <Fact key={`${index}:${field.label}`} label={field.label}>
          <FieldValue field={field} view={view} messages={messages} />
        </Fact>
      ))}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mb-2 min-w-0 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] sm:mb-0">
        {children}
      </dd>
    </>
  );
}

function Details({
  view,
  messages,
}: {
  view: McpApprovalView;
  messages: McpApprovalMessages;
}) {
  const { summary } = view;
  if (summary.arguments !== "stored") {
    return (
      <p className="text-sm text-muted-foreground">
        {summary.arguments === "not-stored"
          ? messages.argumentsNotStored
          : messages.argumentsUnreadable}
      </p>
    );
  }
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group -ms-2 w-fit text-muted-foreground"
        >
          <IconChevronRight
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-90 rtl:rotate-180 rtl:group-data-[state=open]:rotate-90"
          />
          {messages.details}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
          <KeepAddresses text={summary.details ?? ""} />
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReviewNotice({
  loaded,
  appName,
  messages,
  onRetry,
  onOpenApp,
}: {
  loaded: Exclude<Loaded, { status: "loading" } | { status: "ready" }>;
  appName: string;
  messages: McpApprovalMessages;
  onRetry: () => void;
  onOpenApp: () => void;
}) {
  const email = useSession().session?.email ?? "";
  const message =
    loaded.status === "failed"
      ? messages.loadFailed
      : loaded.status === "signed-out"
        ? messages.signInToReview
        : loaded.status === "sign-in-unavailable"
          ? messages.signInUnavailable
          : fill(
              loaded.otherOrganization
                ? messages.otherOrganization
                : messages.notFound,
              { email },
            );
  return (
    <>
      <CardContent className="p-6">
        <p className="text-base leading-relaxed">{message}</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {loaded.status === "failed" ? (
          <Button onClick={onRetry}>{messages.tryAgain}</Button>
        ) : (
          <Button variant="outline" onClick={onOpenApp}>
            {fill(messages.openApp, { app: appName })}
          </Button>
        )}
      </CardFooter>
    </>
  );
}
