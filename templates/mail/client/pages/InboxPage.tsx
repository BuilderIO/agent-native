import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  EmailList,
  InboxZero,
  groupIntoThreads,
} from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useNavigationState,
  type NavigationState,
} from "@/hooks/use-navigation-state";
import {
  useEmail,
  useEmails,
  useThreadMessages,
  useMarkRead,
  useUnarchiveEmail,
  useDeleteDraft,
  useSettings,
} from "@/hooks/use-emails";

import { IntegrationsSidebar } from "@/components/email/IntegrationsSidebar";
import { useGoogleAuthUrl } from "@/hooks/use-google-auth";
import { toast } from "sonner";
import type { EmailMessage } from "@shared/types";

function ContactPanel({
  emailId,
  contactEmail,
}: {
  emailId: string | undefined;
  contactEmail?: string;
}) {
  const { data: email } = useEmail(emailId);
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

  const recentFromContact = allEmails
    .filter((e) => e.from.email === displayEmail && e.id !== emailId)
    .slice(0, 4)
    .map((e) => ({ id: e.id, subject: e.subject }));

  return (
    <IntegrationsSidebar
      email={displayEmail}
      displayName={displayName || displayEmail}
      recentEmails={recentFromContact}
    />
  );
}

function ThreadListSidebar({
  emails,
  activeThreadId,
  view,
  labelSuffix,
}: {
  emails: EmailMessage[];
  activeThreadId: string;
  view: string;
  labelSuffix: string;
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
                navigate(
                  `/${view}/${email.threadId || email.id}${labelSuffix}`,
                );
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

function ConnectionError() {
  const [wantAuth, setWantAuth] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuth);

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuth(false);
    }
  }, [authUrl.data]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-6 w-6 text-red-400/70"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <h2 className="text-[15px] font-semibold text-foreground">
        Unable to load emails
      </h2>
      <p className="mt-1.5 max-w-xs text-[13px] text-muted-foreground/70 leading-relaxed">
        Your Google connection may have expired or the API returned an error.
        Try reconnecting your account.
      </p>
      <button
        onClick={() => setWantAuth(true)}
        disabled={authUrl.isLoading || authUrl.isFetching}
        className="mt-6 flex items-center gap-2 rounded-md bg-white px-5 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-50 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        {authUrl.isFetching ? "Connecting..." : "Reconnect Google"}
      </button>
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
  const { data: settings } = useSettings();
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
  const labelSuffix = activeLabel
    ? `?label=${encodeURIComponent(activeLabel)}`
    : "";

  // Always fetch from the URL view (inbox, starred, etc.)
  // Label tabs use ?label= param and always fetch inbox
  const { data: rawEmails = [], isLoading, isError } = useEmails(view);

  const pinnedLabels = settings?.pinnedLabels ?? [];
  const pinnedUserLabels = pinnedLabels.filter(
    (id) => !["starred", "sent", "drafts", "archive", "trash"].includes(id),
  );

  const emails = useMemo(() => {
    if (activeLabel) {
      // Label tab: show only inbox emails with this label
      return rawEmails.filter((e) => e.labelIds.includes(activeLabel));
    }
    if (view === "inbox" && pinnedUserLabels.length > 0) {
      // Inbox: filter out emails that belong to a pinned label
      return rawEmails.filter(
        (e) => !pinnedUserLabels.some((l) => e.labelIds.includes(l)),
      );
    }
    return rawEmails;
  }, [rawEmails, view, activeLabel, pinnedUserLabels]);

  // Sync current navigation state to file (write-only, so agent can read it)
  useEffect(() => {
    navState.sync({
      view,
      threadId,
      focusedEmailId: focusedId ?? undefined,
    });
  }, [view, threadId, focusedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync displayed email list to application-state so agent can see what's on screen
  const emailListSyncRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (emailListSyncRef.current) clearTimeout(emailListSyncRef.current);
    emailListSyncRef.current = setTimeout(() => {
      const compact = emails.slice(0, 50).map((e) => ({
        id: e.id,
        threadId: e.threadId,
        from: e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email,
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
        isRead: e.isRead,
        isStarred: e.isStarred,
      }));
      fetch("/api/application-state/email-list", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view,
          label: activeLabel,
          count: emails.length,
          emails: compact,
        }),
      }).catch(() => {});
    }, 1000);
    return () => {
      if (emailListSyncRef.current) clearTimeout(emailListSyncRef.current);
    };
  }, [emails, view, activeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync current thread messages to application-state so agent can read them
  const { data: currentThreadMessages } = useThreadMessages(threadId);
  const threadSyncRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (threadSyncRef.current) clearTimeout(threadSyncRef.current);
    if (!threadId || !currentThreadMessages?.length) {
      // Clear thread state when not viewing a thread
      fetch("/api/application-state/thread", { method: "DELETE" }).catch(
        () => {},
      );
      return;
    }
    threadSyncRef.current = setTimeout(() => {
      fetch("/api/application-state/thread", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          messages: currentThreadMessages.map((m) => ({
            id: m.id,
            from: m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
            to: m.to.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)),
            subject: m.subject,
            body: m.body,
            date: m.date,
            isRead: m.isRead,
          })),
        }),
      }).catch(() => {});
    }, 500);
    return () => {
      if (threadSyncRef.current) clearTimeout(threadSyncRef.current);
    };
  }, [threadId, currentThreadMessages]);

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
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);
  const threadIds = useMemo(
    () => threads.map((t) => t.latestMessage.threadId || t.latestMessage.id),
    [threads],
  );

  const searchQuery = searchParams.get("q") ?? undefined;

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

  const deleteDraft = useDeleteDraft();

  // Open a saved draft in the compose window
  const handleDraftOpen = useCallback(
    (email: EmailMessage) => {
      compose.open({
        to: email.to.map((r) => r.email).join(", "),
        cc: email.cc?.map((r) => r.email).join(", ") ?? "",
        bcc: email.bcc?.map((r) => r.email).join(", ") ?? "",
        subject: email.subject === "(no subject)" ? "" : email.subject,
        body: email.body,
        mode: "compose",
        replyToId: (email as any).replyToId,
        replyToThreadId: (email as any).replyToThreadId,
        savedDraftId: email.id,
      });
      // Delete the persistent draft (it's now in the compose window)
      deleteDraft.mutate(email.id);
    },
    [compose, deleteDraft],
  );

  const hasThread = !!threadId;
  const isInboxZero =
    !isLoading && !isError && !hasThread && !searchQuery && threads.length === 0;
  const [sidebarContactEmail, setSidebarContactEmail] = useState<
    string | undefined
  >();

  // Reset sidebar contact when navigating away from a thread
  useEffect(() => {
    setSidebarContactEmail(undefined);
  }, [threadId]);

  // Use the focused email ID for the contact panel, falling back to the selected thread
  const contactEmailId = threadId ?? focusedId ?? undefined;

  // Error state — emails failed to load (expired tokens, missing keys, etc.)
  if (isError && !hasThread && threads.length === 0) {
    return <ConnectionError />;
  }

  // Inbox Zero — full-bleed image, no sidebar
  if (isInboxZero) {
    return <InboxZero />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Thin email list sidebar — shown when viewing a thread */}
      {hasThread && (
        <ThreadListSidebar
          emails={emails}
          activeThreadId={threadId!}
          view={view}
          labelSuffix={labelSuffix}
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
            emails={emails}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            onCompose={handleCompose}
            onArchived={setLastArchivedId}
            undoArchive={undoArchive}
            onDraftOpen={handleDraftOpen}
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
