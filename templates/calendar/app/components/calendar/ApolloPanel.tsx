import { useSendToAgentChat, useT } from "@agent-native/core/client";
import type { CalendarEvent } from "@shared/api";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { useApolloStatus, useApolloConnect } from "@/hooks/use-apollo";

import { IntegrationsSidebar } from "./IntegrationsSidebar";

// ─── Apollo logo SVG ────────────────────────────────────────────────────────

function ApolloLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19.5993 0.0862365L19.605 13.2568C19.6058 15.3375 17.4222 16.6715 15.6079 15.6986L2.58376 8.7153C3.57706 7.05795 4.82616 5.57609 6.27427 4.32386L16.489 13.8945C17.0303 14.4015 17.8835 13.8518 17.6605 13.1398L13.6992 0.493553C15.0326 0.17147 16.4233 0 17.8536 0C18.4428 0 19.0248 0.0296814 19.5993 0.0862365Z"
        fill="#F8FF2C"
      />
      <path
        d="M16.0635 36.1087L16.0578 23.0046C16.057 20.9239 18.2407 19.5898 20.0549 20.5627L33.0838 27.5486C32.0838 29.2016 30.8289 30.6786 29.3751 31.925L19.1738 22.3668C18.6326 21.8598 17.7793 22.4095 18.0023 23.1215L21.9486 35.72C20.6338 36.0329 19.263 36.1989 17.8539 36.1989C17.2497 36.1989 16.6523 36.1683 16.0635 36.1087Z"
        fill="#F8FF2C"
      />
      <path
        d="M22.0105 16.77L31.4705 6.39392C30.2362 4.92008 28.7742 3.6486 27.1384 2.63702L20.2306 15.8767C19.2709 17.716 20.5871 19.9298 22.6396 19.9288L35.6183 19.923C35.6775 19.3234 35.7082 18.7151 35.7082 18.0996C35.7082 16.6683 35.5436 15.2761 35.2338 13.9406L22.7549 17.9576C22.0526 18.1837 21.5103 17.3187 22.0105 16.77Z"
        fill="#F8FF2C"
      />
      <path
        d="M0.0842758 16.3383L13.0237 16.3325C15.0764 16.3317 16.3923 18.5454 15.4327 20.3846L8.56047 33.5561C6.93095 32.547 5.47394 31.2801 4.24344 29.8121L13.653 19.4914C14.1531 18.9427 13.6107 18.0777 12.9084 18.3037L0.485078 22.3029C0.168551 20.954 0 19.5467 0 18.0994C0 17.5051 0.0290814 16.9177 0.0842758 16.3383Z"
        fill="#F8FF2C"
      />
    </svg>
  );
}

// ─── Apollo Setup Prompt ─────────────────────────────────────────────────────

export function ApolloSetupPrompt({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [apiKey, setApiKey] = useState("");
  const connect = useApolloConnect();

  const handleSave = () => {
    const key = apiKey.trim();
    if (!key) return;
    connect.mutate(key, { onSuccess: onDone });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-black p-0.5 shrink-0">
          <ApolloLogo className="h-full w-full" />
        </div>
        <span className="text-[12px] font-medium text-foreground">
          {t("apollo.connectApollo")}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {t("apollo.description")}
      </p>
      <div className="space-y-1.5">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder={t("apollo.apiKeyPlaceholder")}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
        />
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || connect.isPending}
          className="w-full rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {connect.isPending ? t("common.connecting") : t("common.connect")}
        </button>
      </div>
      <div className="rounded-md bg-muted/50 px-2.5 py-2 space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {t("apollo.howToGetKey")}
        </p>
        <ol className="text-[11px] text-muted-foreground/50 space-y-0.5 list-decimal pl-3">
          <li>{t("apollo.steps.login")}</li>
          <li>{t("apollo.steps.api")}</li>
          <li>{t("apollo.steps.connect")}</li>
        </ol>
        <a
          href="https://app.apollo.io/#/settings/integrations/api"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary/70 hover:text-primary hover:underline transition-colors block"
        >
          {t("apollo.openSettings")}
        </a>
      </div>
    </div>
  );
}

// ─── Attendee row with Apollo hover card ─────────────────────────────────────

interface AttendeeWithApolloProps {
  attendee: NonNullable<CalendarEvent["attendees"]>[number];
  children: React.ReactNode;
}

export function AttendeeApolloPopover({
  attendee,
  children,
}: AttendeeWithApolloProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Position to the left of the trigger; if not enough space, position to the right
      const popoverWidth = 320;
      const left =
        rect.left - popoverWidth - 8 > 0
          ? rect.left - popoverWidth - 8
          : rect.right + 8;
      // Keep within vertical viewport
      const top = Math.min(rect.top, window.innerHeight - 400);
      setAnchor({ top: Math.max(8, top), left });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        className="text-left w-full"
      >
        {children}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            data-apollo-popover
            className="fixed z-[9999] rounded-lg border border-border bg-popover shadow-xl overflow-hidden max-h-[80vh]"
            style={{
              top: anchor ? `${anchor.top}px` : "50%",
              left: anchor ? `${anchor.left}px` : "50%",
              width: "320px",
            }}
            onPointerDownCapture={(e) => e.stopPropagation()}
          >
            <IntegrationsSidebar
              email={attendee.email}
              displayName={attendee.displayName || attendee.email}
              recentEmails={[]}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Research Meeting Button ─────────────────────────────────────────────────

export function ResearchMeetingButton({ event }: { event: CalendarEvent }) {
  const t = useT();
  const { connected } = useApolloStatus();
  const [showSetup, setShowSetup] = useState(false);
  const { send, codeRequiredDialog } = useSendToAgentChat();

  const attendees = (event.attendees ?? []).filter((a) => !a.self);
  if (attendees.length === 0) return null;

  const handleResearch = () => {
    if (!connected) {
      setShowSetup(true);
      return;
    }

    const names = attendees.map((a) => a.displayName || a.email).join(", ");
    const emails = attendees.map((a) => a.email).join(", ");

    send({
      message: `Research the attendees for my meeting "${event.title}" and give me a writeup on each person.`,
      context: `Meeting: "${event.title}" on ${event.start}
Attendees (non-self): ${names}
Attendee emails: ${emails}

Use the Apollo API (/api/apollo/person?email=...) to look up each attendee and compile a useful pre-meeting briefing covering their role, company, background, and anything relevant. Format it clearly with a section per person.`,
      submit: true,
    });
  };

  if (showSetup) {
    return (
      <div className="mt-2">
        <ApolloSetupPrompt onDone={() => setShowSetup(false)} />
      </div>
    );
  }

  return (
    <>
      {codeRequiredDialog}
      <button
        onClick={handleResearch}
        className="flex items-center gap-1.5 w-full rounded-lg border border-border bg-muted/30 hover:bg-muted/60 px-3 py-2 text-[12px] font-medium text-foreground/80 hover:text-foreground transition-colors"
      >
        <div className="h-4 w-4 rounded bg-black p-0.5 shrink-0">
          <ApolloLogo className="h-full w-full" />
        </div>
        {t("apollo.researchMeeting")}
        <span className="ml-auto text-[10px] text-muted-foreground/40">
          {t("apollo.attendeeCount", { count: attendees.length })}
        </span>
      </button>
    </>
  );
}
