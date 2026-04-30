import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { trackEvent } from "@agent-native/core/client";

export { trackEvent };

export const templates = [
  {
    name: "Mail",
    slug: "mail",
    replaces: "Replaces or augments Superhuman, Gmail",
    cliCommand: "npx @agent-native/core create my-mail-app --template mail",
    demoUrl: "https://mail.agent-native.com",
    description:
      "Superhuman-style email client with keyboard shortcuts, AI triage, multi-account support, and email automations. Own your inbox workflow.",
    color: "#0ea5e9",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
  },
  {
    name: "Calendar",
    slug: "calendar",
    replaces: "Replaces or augments Google Calendar, Calendly",
    cliCommand:
      "npx @agent-native/core create my-calendar-app --template calendar",
    demoUrl: "https://calendar.agent-native.com",
    description:
      "Full calendar with Google sync, availability management, and a public booking page. The agent finds open slots, creates events, and manages your schedule.",
    color: "#10b981",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffb6c3b483ca24ab3b6c3a758aeceef4c?format=webp&width=800",
  },
  {
    name: "Content",
    slug: "content",
    replaces: "Replaces or augments Notion, Google Docs",
    cliCommand:
      "npx @agent-native/core create my-content-app --template content",
    demoUrl: "https://content.agent-native.com",
    description:
      "Write and organize documents with a rich editor, Notion import/export, and an AI agent that drafts, rewrites, and publishes to any CMS.",
    color: "#7928ca",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800",
  },
  {
    name: "Slides",
    slug: "slides",
    replaces: "Replaces or augments Google Slides, Pitch",
    cliCommand: "npx @agent-native/core create my-slides-app --template slides",
    demoUrl: "https://slides.agent-native.com",
    description:
      "Generate full presentations from a prompt. Edit visually or conversationally. AI image generation, 8 layouts, and presentation mode built in.",
    color: "#f59e0b",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800",
  },
  {
    name: "Video",
    slug: "video",
    replaces: "Replaces or augments video editing",
    cliCommand: "npx @agent-native/core create my-video-app --template videos",
    demoUrl: "https://videos.agent-native.com",
    description:
      "Build React-based video compositions with Remotion. Keyframe animation, 30+ easing curves, camera controls, and agent-assisted editing.",
    color: "#ec4899",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b8bfcc18a1d4c47a491da3b2d4148a4?format=webp&width=800",
  },
  {
    name: "Analytics",
    slug: "analytics",
    replaces: "Replaces or augments Amplitude, Mixpanel, Looker",
    cliCommand:
      "npx @agent-native/core create my-analytics-app --template analytics",
    demoUrl: "https://analytics.agent-native.com",
    description:
      "Connect any data source, prompt for any chart, build reusable dashboards. The agent writes SQL, generates visualizations, and evolves the app.",
    color: "var(--docs-accent)",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800",
  },
  {
    name: "Clips",
    slug: "clips",
    replaces: "Replaces or augments Loom",
    cliCommand: "npx @agent-native/core create my-clips-app --template clips",
    demoUrl: "https://clips.agent-native.com",
    description:
      "Async screen recording with auto-transcripts, shareable links, and an agent that summarizes, captions, and edits clips on demand.",
    color: "#625DF5",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F7366585df5a545e697e254bb0138182d?format=webp&width=800",
  },
  {
    name: "Calls",
    slug: "calls",
    replaces: "Replaces or augments Gong, Chorus",
    cliCommand: "npx @agent-native/core create my-calls-app --template calls",
    demoUrl: "https://calls.agent-native.com",
    description:
      "Record, transcribe, and analyze sales calls with accounts, spaces, comments, trackers, snippets, and agent-generated summaries.",
    color: "#111111",
    screenshot: "",
  },
  {
    name: "Meeting Notes",
    slug: "meeting-notes",
    replaces: "Replaces or augments Otter, meeting note takers",
    cliCommand:
      "npx @agent-native/core create my-meeting-notes-app --template meeting-notes",
    demoUrl: "https://meeting-notes.agent-native.com",
    description:
      "Capture meetings, enhance rough notes into reusable templates, and organize people, companies, decisions, and follow-ups.",
    color: "#16A34A",
    screenshot: "",
  },
  {
    name: "Voice",
    slug: "voice",
    replaces: "Replaces or augments Wispr Flow",
    cliCommand: "npx @agent-native/core create my-voice-app --template voice",
    demoUrl: "https://voice.agent-native.com",
    description:
      "Voice dictation with context-aware formatting, snippets, custom vocabulary, style presets, history, and usage stats.",
    color: "#8B5CF6",
    screenshot: "",
  },
  {
    name: "Design",
    slug: "design",
    replaces: "Replaces or augments Figma, Canva",
    cliCommand: "npx @agent-native/core create my-design-app --template design",
    demoUrl: "https://design.agent-native.com",
    description:
      "Agent-native design tool. Create and edit visual designs by prompt or by hand, with the agent as your co-designer.",
    color: "#F472B6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2F348da13fcd8b414c87de9066196f7266%2F961bedb713a94463b834c1f2f4643bcf?format=webp&width=800",
  },
  {
    name: "Scheduling",
    slug: "scheduling",
    replaces: "Replaces or augments Calendly",
    cliCommand:
      "npx @agent-native/core create my-scheduling-app --template scheduling",
    demoUrl: "https://scheduling.agent-native.com",
    description:
      "Full scheduling with event types, availability, bookings, routing forms, workflows, team round-robin, and calendar integrations.",
    color: "#7C3AED",
    screenshot: "",
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    replaces: "Mission control for your agent-native apps",
    cliCommand:
      "npx @agent-native/core create my-dispatch-app --template dispatch",
    demoUrl: "https://dispatch.agent-native.com",
    description:
      "Centralized messaging and management for every agent in your stack. Talk to your agents from Slack, Telegram, or the web; route jobs, hold memory, approve actions, and delegate across apps over A2A.",
    color: "#14B8A6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F104b3ad8d1dc461aa33ab9bff37a4482?format=webp&width=800",
  },
  {
    name: "Forms",
    slug: "forms",
    replaces: "Replaces or augments Typeform, Google Forms",
    cliCommand: "npx @agent-native/core create my-forms-app --template forms",
    demoUrl: "https://forms.agent-native.com",
    description:
      "Agent-native form builder. Generate forms from a prompt, branch logic with the agent, and own every response in your own database.",
    color: "#06B6D4",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F190c3fabd51f4c1bba5aa4e091ad4e9b?format=webp&width=800",
  },
  {
    name: "Issues",
    slug: "issues",
    replaces: "Replaces or augments Jira, Linear",
    cliCommand:
      "npx @agent-native/core create my-issues-app --template issues",
    demoUrl: "https://issues.agent-native.com",
    description:
      "Project and issue tracking with boards, sprints, comments, transitions, search, and an agent that can triage work.",
    color: "#6366F1",
    screenshot: "",
  },
  {
    name: "Recruiting",
    slug: "recruiting",
    replaces: "Replaces or augments Greenhouse",
    cliCommand:
      "npx @agent-native/core create my-recruiting-app --template recruiting",
    demoUrl: "https://recruiting.agent-native.com",
    description:
      "Manage recruiting pipelines, candidates, jobs, interviews, scorecards, action items, and AI candidate notes around Greenhouse data.",
    color: "#16A34A",
    screenshot: "",
  },
  {
    name: "Starter",
    slug: "starter",
    replaces: "Minimal agent-native scaffold",
    cliCommand:
      "npx @agent-native/core create my-agent-native-app --template starter",
    description:
      "A small starting point with the agent chat, shared state, actions, routing, and the framework conventions already wired up.",
    color: "#71717A",
    screenshot: "",
  },
];

export type Template = (typeof templates)[number];

function CliPopover({
  template,
  buttonRef,
  onClose,
}: {
  template: Template;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "card",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, buttonRef]);

  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    function update() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [buttonRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-[var(--code-border)] bg-[var(--bg)] shadow-lg"
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
        width: "max-content",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <code className="block whitespace-nowrap text-xs leading-relaxed text-[var(--fg)]">
          {template.cliCommand}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1 text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          aria-label="Copy command"
        >
          {copied ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function TemplateLaunchButton({ template }: { template: Template }) {
  const [showCli, setShowCli] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasDemoUrl = "demoUrl" in template && template.demoUrl;

  return (
    <div className="mt-auto flex flex-col gap-2 pt-3">
      {hasDemoUrl && (
        <a
          href={template.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("click try demo", {
              template: template.slug,
              location: "card",
            })
          }
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Try It
        </a>
      )}
      <button
        ref={buttonRef}
        onClick={() => {
          if (!showCli)
            trackEvent("click run locally", {
              template: template.slug,
              location: "card",
            });
          setShowCli(!showCli);
        }}
        className={
          hasDemoUrl
            ? "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
            : "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        Run Locally
      </button>
      {showCli && (
        <CliPopover
          template={template}
          buttonRef={buttonRef}
          onClose={() => setShowCli(false)}
        />
      )}
    </div>
  );
}

export function TemplateCard({ template }: { template: Template }) {
  return (
    <div className="feature-card flex flex-col gap-3 overflow-hidden">
      <Link
        prefetch="render"
        to={`/templates/${template.slug}`}
        className="-mx-[24px] -mt-[24px] mb-1 flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-[var(--docs-border)] bg-[var(--bg-secondary)] transition hover:opacity-90"
        onClick={() =>
          trackEvent("click template", {
            template: template.slug,
            location: "card",
          })
        }
      >
        {template.screenshot ? (
          <img
            src={template.screenshot}
            alt={`${template.name} template screenshot`}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${template.color}, ${template.color}22)`,
            }}
          >
            <span className="rounded-lg bg-[var(--bg)]/80 px-4 py-2 text-sm font-semibold text-[var(--fg)] shadow-sm">
              {template.name}
            </span>
          </div>
        )}
      </Link>
      <h3 className="text-base font-semibold">
        <Link
          prefetch="render"
          to={`/templates/${template.slug}`}
          className="text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
        >
          {template.name}
        </Link>
      </h3>
      <p className="m-0 text-xs text-[var(--docs-accent)]">
        {template.replaces}
      </p>
      <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {template.description}
      </p>
      <TemplateLaunchButton template={template} />
    </div>
  );
}
