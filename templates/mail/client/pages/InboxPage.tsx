import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { EmailList } from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";
import { ComposeModal } from "@/components/email/ComposeModal";
import { useEmail, useEmails } from "@/hooks/use-emails";
import { truncate } from "@/lib/utils";
import type { EmailMessage } from "@shared/types";

function ContactPanel({ emailId }: { emailId: string | undefined }) {
  const { data: email } = useEmail(emailId);
  const { data: allEmails = [] } = useEmails("inbox");

  if (!email) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground/40">No contact selected</p>
      </div>
    );
  }

  const senderName = email.from.name || email.from.email;
  const senderEmail = email.from.email;
  const initials = senderName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Get recent emails from this sender
  const recentFromSender = allEmails
    .filter((e) => e.from.email === senderEmail && e.id !== email.id)
    .slice(0, 4);

  // Extract domain from email
  const domain = senderEmail.split("@")[1];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Notification badge (top right) */}
      <div className="flex justify-end px-3 pt-3">
        <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">4</span>
        </div>
      </div>

      {/* Profile header */}
      <div className="px-4 pb-4">
        <h3 className="text-[15px] font-semibold text-foreground mb-2">
          {senderName}
        </h3>

        <p className="text-[12px] text-muted-foreground mb-0.5">
          {senderEmail}
        </p>
      </div>

      {/* Divider */}
      <div className="h-px bg-border/30 mx-4" />

      {/* Mail section */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5 text-muted-foreground/50"
          >
            <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11z" />
            <path d="M15 6.954L8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954z" />
          </svg>
          <span className="text-[13px] font-medium text-foreground">Mail</span>
        </div>

        {/* Current email subject */}
        <p className="text-[12px] text-muted-foreground/70 truncate mb-0.5">
          {truncate(email.subject, 40)}
        </p>

        {/* Recent emails from sender */}
        {recentFromSender.map((e) => (
          <p
            key={e.id}
            className="text-[12px] text-muted-foreground/70 truncate mb-0.5"
          >
            {truncate(e.subject, 40)}
          </p>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border/30 mx-4" />

      {/* Social/domain links */}
      <div className="px-4 py-3 space-y-2">
        <a
          href="#"
          className="flex items-center gap-2 text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
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

        <a
          href="#"
          className="flex items-center gap-2 text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3 w-3 text-green-400/60 shrink-0"
          >
            <path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm-.5-3.5a.5.5 0 0 1-.5-.5V8a.5.5 0 0 1 1 0v3a.5.5 0 0 1-.5.5zm0-6.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
          </svg>
          {domain}
        </a>
      </div>
    </div>
  );
}

export function InboxPage() {
  const { threadId } = useParams<{ view: string; threadId: string }>();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [composeEmail, setComposeEmail] = useState<EmailMessage | null>(null);
  const [composeMode, setComposeMode] = useState<"reply" | "forward">("reply");
  const [composeOpen, setComposeOpen] = useState(false);

  const handleCompose = useCallback(
    (email: EmailMessage, mode: "reply" | "forward") => {
      setComposeEmail(email);
      setComposeMode(mode);
      setComposeOpen(true);
    },
    [],
  );

  const hasThread = !!threadId;

  // Use the focused email ID for the contact panel, falling back to the selected thread
  const contactEmailId = threadId ?? focusedId ?? undefined;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Center area — email list OR thread view (Superhuman replaces, not side by side) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {hasThread ? (
          <EmailThread />
        ) : (
          <EmailList
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            onCompose={handleCompose}
          />
        )}
      </div>

      {/* Right contact panel */}
      <div className="hidden lg:flex w-[260px] shrink-0 flex-col border-l border-border/30 bg-[hsl(220,6%,9%)]">
        <ContactPanel emailId={contactEmailId} />
      </div>

      {/* Compose from list shortcuts */}
      <ComposeModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        replyTo={composeEmail ?? undefined}
        mode={composeMode}
      />
    </div>
  );
}
