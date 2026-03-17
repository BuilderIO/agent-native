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
  useSettings,
} from "@/hooks/use-emails";

import { IntegrationsSidebar } from "@/components/email/IntegrationsSidebar";
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
  const { data: rawEmails = [], isLoading } = useEmails(view);

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

  const hasThread = !!threadId;
  const isInboxZero =
    !isLoading && !hasThread && !searchQuery && threads.length === 0;
  const [sidebarContactEmail, setSidebarContactEmail] = useState<
    string | undefined
  >();

  // Reset sidebar contact when navigating away from a thread
  useEffect(() => {
    setSidebarContactEmail(undefined);
  }, [threadId]);

  // Use the focused email ID for the contact panel, falling back to the selected thread
  const contactEmailId = threadId ?? focusedId ?? undefined;

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
