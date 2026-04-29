import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { trackEvent } from "@agent-native/core/client";

export { trackEvent };

export const templates = [
  {
    name: "Clips",
    slug: "clips",
    replaces: "Async screen recording for teams",
    cliCommand: "npx @agent-native/core create my-clips-app",
    demoUrl: "https://clips.agent-native.com",
    description:
      "Async screen recording with auto-transcripts, shareable links, and an agent that summarizes, captions, and edits clips on demand.",
    color: "#625DF5",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
  },
  {
    name: "Design",
    slug: "design",
    replaces: "Replaces or augments Figma, Canva",
    cliCommand: "npx @agent-native/core create my-design-app",
    demoUrl: "https://design.agent-native.com",
    description:
      "AI-native design tool. Create and edit visual designs by prompt or by hand, with the agent as your co-designer.",
    color: "#F472B6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
  },
  {
    name: "Dispatch",
    slug: "dispatch",
    replaces: "Replaces or augments Slack/Telegram bots and Zapier",
    cliCommand: "npx @agent-native/core create my-dispatch-app",
    demoUrl: "https://dispatch.agent-native.com",
    description:
      "Central messaging router for your agents. Talk to it from Slack or Telegram and it routes work, manages jobs, memory, approvals, and A2A delegation across every app.",
    color: "#14B8A6",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
  },
  {
    name: "Forms",
    slug: "forms",
    replaces: "Replaces or augments Typeform, Google Forms",
    cliCommand: "npx @agent-native/core create my-forms-app",
    demoUrl: "https://forms.agent-native.com",
    description:
      "AI-native form builder. Generate forms from a prompt, branch logic with the agent, and own every response in your own database.",
    color: "#06B6D4",
    screenshot:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800",
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
        <img
          src={template.screenshot}
          alt={`${template.name} template screenshot`}
          className="h-full w-full object-cover object-top"
        />
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
