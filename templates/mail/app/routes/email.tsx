import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { postNavigate, isInAgentEmbed } from "@agent-native/core/client";
import { useThreadMessages } from "@/hooks/use-emails";
import { formatEmailDate, formatEmailDateFull, cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconExternalLink } from "@tabler/icons-react";
import type { EmailMessage } from "@shared/types";

export function meta() {
  return [{ title: "Email" }];
}

// ─── Message Card ────────────────────────────────────────────────────────────

function MessageCard({ message }: { message: EmailMessage }) {
  const fromName = message.from.name || message.from.email;
  const toList = message.to.map((a) => a.name || a.email).join(", ");
  const safeHtml = useMemo(
    () => (message.bodyHtml ? sanitizeHtml(message.bodyHtml) : null),
    [message.bodyHtml],
  );

  return (
    <div className="border-b border-border/40 last:border-b-0 py-4 px-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "text-[13px] font-medium truncate",
              message.isRead ? "text-foreground/80" : "text-foreground",
            )}
          >
            {fromName}
          </span>
        </div>
        <time
          className="text-[11px] text-muted-foreground/60 shrink-0 pt-0.5"
          title={formatEmailDateFull(message.date)}
        >
          {formatEmailDate(message.date)}
        </time>
      </div>

      {toList && (
        <div className="text-[11px] text-muted-foreground/50 mb-2 truncate">
          To: {toList}
        </div>
      )}

      {safeHtml ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 overflow-x-auto [&_img]:max-w-full [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <pre className="whitespace-pre-wrap text-[13px] text-foreground/80 font-sans leading-relaxed">
          {message.body}
        </pre>
      )}
    </div>
  );
}

// ─── Error State ─────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="text-sm font-medium text-foreground mb-1">
          Unable to load thread
        </div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className="border-b border-border/40 pb-4 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-3 w-24" />
          <div className="space-y-1.5 mt-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

export default function EmailEmbedRoute() {
  const [params] = useSearchParams();
  const threadId = params.get("threadId");
  const view = params.get("view") ?? "inbox";
  const inEmbed = isInAgentEmbed();

  const { data: messages, isLoading } = useThreadMessages(
    threadId ?? undefined,
  );

  if (!threadId) {
    return <ErrorState message="No thread ID provided." />;
  }

  const subject =
    messages && messages.length > 0 ? messages[0].subject : undefined;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Header bar */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card/80 px-3 py-2">
        <div className="flex-1 min-w-0">
          {subject ? (
            <h1 className="text-[13px] font-semibold truncate">{subject}</h1>
          ) : isLoading ? (
            <Skeleton className="h-4 w-48" />
          ) : (
            <h1 className="text-[13px] font-semibold text-muted-foreground">
              Email thread
            </h1>
          )}
        </div>
        {inEmbed && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-[12px] text-muted-foreground hover:text-foreground px-2"
            onClick={() => postNavigate(`/${view}/${threadId}`)}
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            Open in app
          </Button>
        )}
      </header>

      {/* Thread content */}
      <main className="flex-1 overflow-y-auto">
        {isLoading && !messages ? (
          <LoadingSkeleton />
        ) : !messages || messages.length === 0 ? (
          <ErrorState message="Thread not found or has no messages." />
        ) : (
          <div>
            {messages.map((msg) => (
              <MessageCard key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
