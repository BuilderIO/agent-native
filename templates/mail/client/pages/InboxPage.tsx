import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { EmailList, groupIntoThreads } from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useNavigationState,
  type NavigationState,
} from "@/hooks/use-navigation-state";
import {
  useEmail,
  useEmails,
  useMarkRead,
  useUnarchiveEmail,
} from "@/hooks/use-emails";

import {
  useApolloStatus,
  useApolloConnect,
  useApolloDisconnect,
  useApolloPerson,
} from "@/hooks/use-apollo";
import { toast } from "sonner";
import { truncate } from "@/lib/utils";
import type { EmailMessage } from "@shared/types";

function ApolloConnectCTA() {
  const [expanded, setExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const connect = useApolloConnect();
  const helpRef = useRef<HTMLDivElement>(null);

  // Close help popover on outside click
  useEffect(() => {
    if (!showHelp) return;
    const handleClick = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelp(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showHelp]);

  if (!expanded) {
    return (
      <div className="px-4 py-2">
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          Enrich with Apollo
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-muted-foreground">
          Apollo API key
        </span>
        <div className="relative" ref={helpRef}>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-muted-foreground/40 hover:text-muted-foreground border border-border/40 hover:border-border transition-colors"
          >
            ?
          </button>
          {showHelp && (
            <div className="absolute right-0 top-6 z-50 w-56 rounded-lg border border-border bg-popover p-3 shadow-lg">
              <p className="text-[11px] text-muted-foreground mb-2">
                To get your API key:
              </p>
              <ol className="text-[11px] text-muted-foreground/70 space-y-1 list-decimal pl-3 mb-2">
                <li>Log in to Apollo.io</li>
                <li>Go to Settings &gt; Integrations &gt; API</li>
                <li>Click "Connect" to generate a key</li>
              </ol>
              <a
                href="https://app.apollo.io/#/settings/integrations/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline"
              >
                Open Apollo Settings
              </a>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste key..."
          autoFocus
          className="flex-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
        />
        <button
          onClick={() => {
            if (apiKey.trim()) connect.mutate(apiKey.trim());
          }}
          disabled={!apiKey.trim() || connect.isPending}
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {connect.isPending ? "..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function ApolloEnrichment({ email }: { email: string }) {
  const { data: person, isLoading, isError } = useApolloPerson(email);
  const disconnect = useApolloDisconnect();

  if (isLoading) {
    return (
      <div className="px-4 py-4 flex items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }

  if (isError || !person) {
    return (
      <div className="px-4 py-2">
        <p className="text-[11px] text-muted-foreground/40">
          No additional info found via Apollo.
        </p>
        <button
          onClick={() => disconnect.mutate()}
          className="text-[11px] text-muted-foreground/30 hover:text-muted-foreground transition-colors mt-2"
        >
          Disconnect Apollo
        </button>
      </div>
    );
  }

  const location = [person.city, person.state, person.country]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      {/* Title & photo */}
      {(person.photo_url || person.title) && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3 flex items-start gap-3">
            {person.photo_url && (
              <img
                src={person.photo_url}
                alt=""
                className="h-9 w-9 rounded-full object-cover shrink-0"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0">
              {person.title && (
                <p className="text-[12px] text-foreground/80">{person.title}</p>
              )}
              {person.headline && person.headline !== person.title && (
                <p className="text-[11px] text-muted-foreground/60 truncate">
                  {person.headline}
                </p>
              )}
              {location && (
                <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                  {location}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Company */}
      {person.organization && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              {person.organization.logo_url ? (
                <img
                  src={person.organization.logo_url}
                  alt=""
                  className="h-4 w-4 rounded object-contain shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-4 w-4 rounded bg-accent flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
                  {person.organization.name?.[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[13px] font-medium text-foreground truncate">
                {person.organization.name}
              </span>
            </div>
            {person.organization.short_description && (
              <p className="text-[11px] text-muted-foreground/70 line-clamp-2 mb-1.5">
                {person.organization.short_description}
              </p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
              {person.organization.industry && (
                <span>{person.organization.industry}</span>
              )}
              {person.organization.estimated_num_employees && (
                <span>
                  {person.organization.estimated_num_employees.toLocaleString()}
                  + employees
                </span>
              )}
              {person.organization.founded_year && (
                <span>Est. {person.organization.founded_year}</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Links */}
      {(person.linkedin_url ||
        person.twitter_url ||
        person.github_url ||
        person.organization?.website_url) && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3 space-y-1.5">
            {person.linkedin_url && (
              <a
                href={person.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3 text-blue-400/60 shrink-0"
                >
                  <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 0 1 .016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z" />
                </svg>
                LinkedIn
              </a>
            )}
            {person.twitter_url && (
              <a
                href={person.twitter_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3 text-muted-foreground/50 shrink-0"
                >
                  <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865l8.875 11.633Z" />
                </svg>
                X / Twitter
              </a>
            )}
            {person.github_url && (
              <a
                href={person.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3 text-muted-foreground/50 shrink-0"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                GitHub
              </a>
            )}
            {person.organization?.website_url && (
              <a
                href={person.organization.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3 text-muted-foreground/50 shrink-0"
                >
                  <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z" />
                </svg>
                {person.organization.website_url
                  .replace(/^https?:\/\/(www\.)?/, "")
                  .replace(/\/$/, "")}
              </a>
            )}
          </div>
        </>
      )}

      {/* Employment history */}
      {person.employment_history && person.employment_history.length > 1 && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Experience
            </h4>
            <div className="space-y-2">
              {person.employment_history.slice(0, 4).map((job, i) => (
                <div key={i}>
                  <p className="text-[12px] text-foreground/80 truncate">
                    {job.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground/50 truncate">
                    {job.organization_name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Disconnect link */}
      <div className="h-px bg-border/30 mx-4" />
      <div className="px-4 py-3">
        <button
          onClick={() => disconnect.mutate()}
          className="text-[11px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
        >
          Disconnect Apollo
        </button>
      </div>
    </>
  );
}

function ContactPanel({
  emailId,
  contactEmail,
}: {
  emailId: string | undefined;
  contactEmail?: string;
}) {
  const { data: email } = useEmail(emailId);
  const { connected } = useApolloStatus();
  const { data: allEmails = [] } = useEmails("inbox");

  const displayEmail = contactEmail || email?.from.email;
  const displayName = contactEmail
    ? contactEmail
    : email?.from.name || email?.from.email;

  if (!displayEmail) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground/40">No contact selected</p>
      </div>
    );
  }

  const domain = displayEmail.split("@")[1];

  const recentFromContact = allEmails
    .filter((e) => e.from.email === displayEmail && e.id !== emailId)
    .slice(0, 4);

  // When Apollo is connected, show the enriched view (replaces generic info)
  if (connected) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        {/* Minimal header — name + email */}
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-[14px] font-semibold text-foreground mb-1">
            {displayName}
          </h3>
          {displayName !== displayEmail && (
            <p className="text-[12px] text-muted-foreground">{displayEmail}</p>
          )}
          <p className="text-[11px] text-muted-foreground/50">{domain}</p>
        </div>

        {/* Recent emails */}
        {recentFromContact.length > 0 && (
          <>
            <div className="h-px bg-border/30 mx-4" />
            <div className="px-4 py-3">
              <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
                Recent
              </h4>
              {recentFromContact.map((e) => (
                <p
                  key={e.id}
                  className="text-[12px] text-muted-foreground/70 truncate mb-0.5"
                >
                  {truncate(e.subject, 40)}
                </p>
              ))}
            </div>
          </>
        )}

        {/* Apollo enrichment — replaces generic links/info */}
        <ApolloEnrichment email={displayEmail} />
      </div>
    );
  }

  // Generic view (no Apollo)
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Profile header */}
      <div className="px-4 pt-4 pb-3">
        <h3 className="text-[14px] font-semibold text-foreground mb-1">
          {displayName}
        </h3>
        {displayName !== displayEmail && (
          <p className="text-[12px] text-muted-foreground">{displayEmail}</p>
        )}
        <p className="text-[11px] text-muted-foreground/50">{domain}</p>
      </div>

      {/* Recent emails */}
      {recentFromContact.length > 0 && (
        <>
          <div className="h-px bg-border/30 mx-4" />
          <div className="px-4 py-3">
            <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Recent
            </h4>
            {recentFromContact.map((e) => (
              <p
                key={e.id}
                className="text-[12px] text-muted-foreground/70 truncate mb-0.5"
              >
                {truncate(e.subject, 40)}
              </p>
            ))}
          </div>
        </>
      )}

      <ApolloConnectCTA />
    </div>
  );
}

function ThreadListSidebar({
  emails,
  activeThreadId,
  view,
}: {
  emails: EmailMessage[];
  activeThreadId: string;
  view: string;
}) {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);

  return (
    <div className="w-[220px] shrink-0 flex flex-col border-r border-border/30 bg-[hsl(220,6%,5%)] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => {
          const email = thread.latestMessage;
          const isActive = (email.threadId || email.id) === activeThreadId;
          const senderName =
            thread.messageCount > 1
              ? thread.participants.map((p) => p.split(" ")[0]).join(", ")
              : email.from.name || email.from.email;
          return (
            <button
              key={email.id}
              onClick={() => {
                if (!email.isRead)
                  markRead.mutate({ id: email.id, isRead: true });
                navigate(`/${view}/${email.threadId || email.id}`);
              }}
              className={cn(
                "w-full text-left px-3 py-2 border-b border-border/10 transition-colors",
                isActive ? "bg-primary/10" : "hover:bg-[hsl(220,5%,13%)]",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {thread.hasUnread && (
                  <div className="h-[5px] w-[5px] rounded-full bg-primary shrink-0" />
                )}
                <span
                  className={cn(
                    "text-[12px] truncate",
                    thread.hasUnread
                      ? "font-semibold text-foreground"
                      : "text-foreground/80",
                  )}
                >
                  {email.subject}
                </span>
                {thread.messageCount > 1 && (
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {thread.messageCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5 pl-0">
                {senderName}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function InboxPage() {
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const compose = useComposeState();
  const navState = useNavigationState();
  const [lastArchivedId, setLastArchivedId] = useState<string | null>(null);
  const unarchiveEmail = useUnarchiveEmail();
  const { data: emails = [] } = useEmails(view);

  // Sync current navigation state to file (write-only, so agent can read it)
  useEffect(() => {
    navState.sync({
      view,
      threadId,
      focusedEmailId: focusedId ?? undefined,
    });
  }, [view, threadId, focusedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot agent navigation: agent writes navigate.json, UI reads it, navigates, deletes it
  const { data: navCommand } = navState.command;
  const lastCommandRef = useRef<string>("");
  useEffect(() => {
    if (!navCommand) return;
    const key = JSON.stringify(navCommand);
    if (key === lastCommandRef.current) return;
    lastCommandRef.current = key;

    const targetView = navCommand.view || view;
    const targetThread = navCommand.threadId;

    if (targetThread) {
      navigate(`/${targetView}/${targetThread}`);
    } else if (targetView !== view) {
      navigate(`/${targetView}`);
    }

    // Delete the command file so it doesn't re-trigger
    navState.clearCommand();
  }, [navCommand, view, navigate]); // eslint-disable-line react-hooks/exhaustive-deps
  const threadIds = useMemo(
    () =>
      groupIntoThreads(emails).map(
        (t) => t.latestMessage.threadId || t.latestMessage.id,
      ),
    [emails],
  );

  const undoArchive = useCallback(
    (id: string) => {
      unarchiveEmail.mutate(id, {
        onSuccess: () => {
          toast("Undone.");
          setLastArchivedId(null);
        },
      });
    },
    [unarchiveEmail],
  );

  const handleCompose = useCallback(
    (email: EmailMessage, mode: "reply" | "forward") => {
      if (mode === "reply") {
        compose.open({
          to: email.from.email,
          subject: email.subject.startsWith("Re:")
            ? email.subject
            : `Re: ${email.subject}`,
          body: `\n\n— On ${new Date(email.date).toLocaleDateString()}, ${email.from.name || email.from.email} wrote:\n\n${email.body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")}`,
          mode: "reply",
          replyToId: email.id,
          replyToThreadId: email.threadId,
        });
      } else {
        compose.open({
          to: "",
          subject: email.subject.startsWith("Fwd:")
            ? email.subject
            : `Fwd: ${email.subject}`,
          body: `\n\n— Forwarded message —\nFrom: ${email.from.name} <${email.from.email}>\n\n${email.body}`,
          mode: "forward",
          replyToId: email.id,
          replyToThreadId: email.threadId,
        });
      }
    },
    [compose],
  );

  const hasThread = !!threadId;
  const [sidebarContactEmail, setSidebarContactEmail] = useState<
    string | undefined
  >();

  // Reset sidebar contact when navigating away from a thread
  useEffect(() => {
    setSidebarContactEmail(undefined);
  }, [threadId]);

  // Use the focused email ID for the contact panel, falling back to the selected thread
  const contactEmailId = threadId ?? focusedId ?? undefined;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Thin email list sidebar — shown when viewing a thread */}
      {hasThread && (
        <ThreadListSidebar
          emails={emails}
          activeThreadId={threadId!}
          view={view}
        />
      )}

      {/* Center area — email list OR thread view */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {hasThread ? (
          <EmailThread
            onArchived={setLastArchivedId}
            emailIds={threadIds}
            onContactSelect={setSidebarContactEmail}
          />
        ) : (
          <EmailList
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            onCompose={handleCompose}
            onArchived={setLastArchivedId}
            undoArchive={undoArchive}
          />
        )}
      </div>

      {/* Right contact panel */}
      <div className="hidden lg:flex w-[260px] shrink-0 flex-col border-l border-border/30 bg-[hsl(220,6%,5%)]">
        <ContactPanel
          emailId={contactEmailId}
          contactEmail={sidebarContactEmail}
        />
      </div>
    </div>
  );
}
