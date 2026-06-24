import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  IconBrain,
  IconDatabase,
  IconRoute,
  IconServer,
} from "@tabler/icons-react";
import { AgentNativeDemoVideo } from "../components/AgentNativeDemoVideo";
import CodeBlock from "../components/CodeBlock";
import Seascape from "../components/Seascape";
import {
  featuredTemplates,
  TemplateCard,
  trackEvent,
} from "../components/TemplateCard";

const quickStartCode = `# Start with a chat-first app
npx @agent-native/core@latest create my-chat-app --template chat
cd my-chat-app
pnpm install
pnpm action hello --name Builder
pnpm agent "Call hello for Builder"`;

const skillInstallCode = `# Add agent-native planning to a coding agent you already use
npx @agent-native/core@latest skills add visual-plan`;

const frameworkCode = `// One action powers the agent, UI, HTTP, MCP, A2A, and CLI.
export default defineAction({
  description: "Say hello from the local app-agent loop.",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => ({ message: \`Hello, \${name}!\` }),
});`;

function TerminalCommand() {
  const [copied, setCopied] = useState(false);
  const command =
    "npx @agent-native/core@latest create my-chat-app --template chat";

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    trackEvent("copy cli command", { location: "hero" });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="group mx-auto mt-8 flex items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-5 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)]"
    >
      <span className="text-[var(--fg-secondary)]">$</span>
      <span className="terminal-command-text min-w-0 flex-1 text-[var(--fg)]">
        {command}
      </span>
      <span className="ml-2 text-[var(--fg-secondary)] opacity-0 transition group-hover:opacity-100">
        {copied ? (
          <svg
            width="16"
            height="16"
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
            width="16"
            height="16"
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
      </span>
    </button>
  );
}

const bidirectionalTabs = [
  {
    title: "The agent sees everything",
    description:
      "It can read and update any UI, any data, any state in the application.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa7b4e0fca8154ab6a82414178d3a4521%2Fcompressed?token=a7b4e0fca8154ab6a82414178d3a4521&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    title: "The UI talks to the agent",
    description:
      "Buttons, forms, and workflows push structured content to the agent, giving you guided flows that all go through the agent — including skills, rules, and instructions.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F02f0369cc97345aa89311d0909b24611%2Fcompressed?token=02f0369cc97345aa89311d0909b24611&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    title: "The agent updates its own code",
    description:
      "It can modify the app itself to change features and functionality. Your tools get better over time.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1aade099ff6d4e9ca04f8534d3314383%2Fcompressed?token=1aade099ff6d4e9ca04f8534d3314383&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    title: "Everything works both ways",
    description:
      "Every action available in the UI is also available to the agent. You can click to do something, or ask the agent to do it.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F39c6b297895843708938b097d8e3eb2c?alt=media&token=c5fdf84c-d4fb-45b0-b220-ef7aab01e99f", // ggignore: public Builder CDN media token
  },
];

const frameworkPrimitives = [
  {
    title: "Actions",
    description: "Define work once. Use it from agent, UI, API, MCP, and A2A.",
    icon: IconRoute,
  },
  {
    title: "Shared state",
    description:
      "SQL-backed app state keeps humans, agents, and sessions in sync.",
    icon: IconDatabase,
  },
  {
    title: "Agent runtime",
    description:
      "The app-agent loop, tools, skills, memory, jobs, and observability ship together.",
    icon: IconBrain,
  },
  {
    title: "Backend agnostic",
    description:
      "Plug in any Drizzle-supported SQL database and Nitro-compatible host.",
    icon: IconServer,
  },
];

const homepageTemplateSlugs = [
  "clips",
  "plan",
  "design",
  "content",
  "slides",
  "analytics",
];

const homepageTemplates = homepageTemplateSlugs.flatMap((slug) =>
  featuredTemplates.filter((template) => template.slug === slug),
);

const featureCloudRows = [
  {
    className: "-translate-x-10",
    words: [
      {
        label: "Notifications",
        className: "text-base uppercase opacity-[0.18]",
      },
      {
        label: "Recurring jobs",
        className: "text-lg uppercase opacity-[0.22]",
      },
      { label: "Actions", className: "text-5xl opacity-[0.95]" },
      {
        label: "Agent teams",
        className: "text-xl uppercase opacity-[0.22]",
      },
      {
        label: "Monorepos",
        className: "text-lg uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "translate-x-12",
    words: [
      { label: "Permissions", className: "text-xl uppercase opacity-[0.18]" },
      { label: "RBAC", className: "text-lg uppercase opacity-[0.18]" },
      { label: "Organizations", className: "text-2xl opacity-[0.24]" },
      { label: "Workspace secrets", className: "text-lg uppercase opacity-[0.16]" },
      { label: "Docs search", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Source search", className: "text-xl uppercase opacity-[0.18]" },
    ],
  },
  {
    className: "translate-x-8",
    words: [
      {
        label: "Context awareness",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { label: "Observability", className: "text-4xl opacity-[0.86]" },
      {
        label: "Realtime sync",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { label: "SQL state", className: "text-4xl opacity-[0.86]" },
      {
        label: "Multi-tenancy",
        className: "text-xl uppercase opacity-[0.22]",
      },
    ],
  },
  {
    className: "-translate-x-14",
    words: [
      { label: "Agent instructions", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Provider grants", className: "text-lg uppercase opacity-[0.16]" },
      { label: "Notifications", className: "text-2xl opacity-[0.24]" },
      { label: "Comments", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Review links", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Privacy controls", className: "text-lg uppercase opacity-[0.16]" },
    ],
  },
  {
    className: "-translate-x-4",
    words: [
      {
        label: "Skills",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { label: "Security", className: "text-3xl opacity-[0.58]" },
      { label: "Audit logs", className: "text-3xl opacity-[0.54]" },
      { label: "Workspaces", className: "text-3xl opacity-[0.46]" },
      {
        label: "Voice input",
        className: "text-lg uppercase opacity-[0.18]",
      },
      {
        label: "MCP apps",
        className: "text-xl uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "feature-cloud-center-row",
    words: [
      { label: "i18n", className: "text-5xl opacity-[0.92]" },
      { label: "MCP Auth", className: "text-2xl opacity-[0.44]" },
      {
        label: "Battle-tested components",
        className:
          "feature-cloud-center-card max-w-[260px] whitespace-normal rounded-2xl border border-[var(--docs-accent)] bg-[#151515] px-6 py-5 text-center text-2xl opacity-100 shadow-[0_18px_70px_rgba(0,0,0,0.96)] sm:max-w-[310px] sm:px-8 sm:py-6 sm:text-4xl",
      },
      { label: "MCP + A2A", className: "text-5xl opacity-[0.92]" },
    ],
  },
  {
    className: "translate-x-6",
    words: [
      {
        label: "Durable resume",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { label: "Extensions", className: "text-3xl opacity-[0.48]" },
      { label: "Sharing & privacy", className: "text-2xl opacity-[0.34]" },
      {
        label: "Real-time collaboration",
        className: "text-2xl opacity-[0.30]",
      },
      { label: "SSO", className: "text-2xl opacity-[0.44]" },
      {
        label: "OAuth",
        className: "text-lg uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "-translate-x-8",
    words: [
      {
        label: "DB adapters",
        className: "text-lg uppercase opacity-[0.22]",
      },
      { label: "Auth", className: "text-4xl opacity-[0.84]" },
      { label: "Approvals", className: "text-3xl opacity-[0.44]" },
      { label: "Automations", className: "text-3xl opacity-[0.46]" },
      { label: "Governance", className: "text-3xl opacity-[0.48]" },
      { label: "Jobs", className: "text-4xl opacity-[0.84]" },
      {
        label: "AG-UI",
        className: "text-lg uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "translate-x-4",
    words: [
      { label: "Rate limits", className: "text-lg uppercase opacity-[0.16]" },
      { label: "Queues", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Cron schedules", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Analytics", className: "text-2xl opacity-[0.28]" },
      { label: "Experiments", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Feedback loops", className: "text-lg uppercase opacity-[0.16]" },
    ],
  },
  {
    className: "translate-x-12",
    words: [
      {
        label: "File uploads",
        className: "text-xl uppercase opacity-[0.20]",
      },
      { label: "Evals", className: "text-2xl opacity-[0.46]" },
      { label: "Templates", className: "text-5xl opacity-[0.92]" },
      { label: "Provider APIs", className: "text-2xl opacity-[0.36]" },
      {
        label: "Agent web surfaces",
        className: "text-xl uppercase opacity-[0.18]",
      },
    ],
  },
  {
    className: "-translate-x-2",
    words: [
      {
        label: "Local file mode",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        label: "Memory",
        className: "text-lg uppercase opacity-[0.18]",
      },
      {
        label: "Webhooks",
        className: "text-xl uppercase opacity-[0.22]",
      },
      {
        label: "HTTP",
        className: "text-xl uppercase opacity-[0.20]",
      },
      {
        label: "Self-editing code",
        className: "text-lg uppercase opacity-[0.16]",
      },
      {
        label: "CLI",
        className: "text-xl uppercase opacity-[0.24]",
      },
      {
        label: "Cross-app SSO",
        className: "text-lg uppercase opacity-[0.16]",
      },
    ],
  },
  {
    className: "translate-x-16",
    words: [
      { label: "Schema migrations", className: "text-lg uppercase opacity-[0.16]" },
      { label: "Hosted deploys", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Environment setup", className: "text-lg uppercase opacity-[0.16]" },
      { label: "OAuth callbacks", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Exports", className: "text-xl uppercase opacity-[0.18]" },
      { label: "Dashboards", className: "text-2xl opacity-[0.24]" },
    ],
  },
];

function BidirectionalTabs() {
  const [activeTab, setActiveTab] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const tabButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    videoRefs.current.forEach((video, i) => {
      if (!video) return;
      if (i === activeTab) {
        video.currentTime = 0;
        void video.play().catch(() => {
          // Browsers reject play() if the tab/video unmounts mid-request.
        });
      } else {
        video.pause();
      }
    });
  }, [activeTab]);

  // Scroll only within the tab container (horizontal, mobile only).
  // Never uses scrollIntoView — that causes full-page vertical jumps.
  const scrollTabIntoContainerView = (index: number) => {
    const btn = tabButtonRefs.current[index];
    const container = tabContainerRef.current;
    if (!btn || !container) return;
    // On desktop the container is flex-col with no fixed width overflow,
    // all tabs are visible — skip entirely if no horizontal overflow.
    if (container.scrollWidth <= container.clientWidth) return;
    const btnLeft = btn.offsetLeft;
    const btnRight = btnLeft + btn.offsetWidth;
    const { scrollLeft, offsetWidth } = container;
    if (btnLeft < scrollLeft) {
      container.scrollTo({ left: btnLeft, behavior: "smooth" });
    } else if (btnRight > scrollLeft + offsetWidth) {
      container.scrollTo({ left: btnRight - offsetWidth, behavior: "smooth" });
    }
  };

  // Scroll the newly-active tab button into the container's horizontal view
  // whenever activeTab changes (covers both clicks and auto-advance).
  useEffect(() => {
    scrollTabIntoContainerView(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleTabClick = (index: number, btn: HTMLButtonElement | null) => {
    setActiveTab(index);
    // Re-focus with preventScroll so keyboard a11y is maintained but the
    // page doesn't jump. (mousedown preventDefault removed native focus.)
    btn?.focus({ preventScroll: true });
  };

  const handleVideoEnded = (i: number) => {
    setActiveTab((prev) => {
      if (prev !== i) return prev;
      return (i + 1) % bidirectionalTabs.length;
    });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <div
        ref={tabContainerRef}
        className="flex shrink-0 flex-row gap-2 overflow-x-auto px-1 py-1 md:w-1/4 md:flex-col md:gap-3 md:overflow-visible md:p-0"
      >
        {bidirectionalTabs.map((tab, i) => (
          <button
            key={i}
            ref={(el) => {
              tabButtonRefs.current[i] = el;
            }}
            onMouseDown={(e) => {
              // Prevent the browser from auto-scrolling the page to the
              // focused element — we handle container-only scrolling ourselves.
              e.preventDefault();
            }}
            onClick={(e) =>
              handleTabClick(i, e.currentTarget as HTMLButtonElement)
            }
            className={`cursor-pointer rounded-xl border p-4 text-left transition-all md:p-5 ${
              i === activeTab
                ? "border-[var(--docs-accent)] bg-[var(--docs-accent)]/12 shadow-[0_0_0_2px_var(--docs-accent)]"
                : "border-[var(--docs-border)] hover:border-[var(--fg-secondary)]/40 hover:bg-[var(--docs-border)]/30"
            }`}
          >
            <div className="mb-1 whitespace-nowrap text-sm font-semibold md:whitespace-normal">
              {tab.title}
            </div>
            <p
              className={`m-0 text-sm leading-relaxed text-[var(--fg-secondary)] ${
                i === activeTab ? "hidden md:block" : "hidden"
              }`}
            >
              {tab.description}
            </p>
          </button>
        ))}
      </div>
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-[var(--docs-border)] bg-black md:w-3/4">
        {bidirectionalTabs.map((tab, i) => (
          <video
            key={i}
            ref={(el) => {
              videoRefs.current[i] = el;
            }}
            src={tab.video}
            muted
            playsInline
            preload="auto"
            onEnded={() => handleVideoEnded(i)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              i === activeTab ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function FeatureWordCloud({ className = "" }: { className?: string }) {
  return (
    <div
      className={`feature-cloud pointer-events-none overflow-hidden bg-black ${className}`}
      aria-hidden="true"
    >
      <div className="feature-cloud-flow absolute left-1/2 top-1/2 flex w-[780px] -translate-x-1/2 -translate-y-1/2 scale-[0.82] flex-col items-center gap-6 px-8 sm:w-[960px] sm:scale-[0.78] sm:gap-8 lg:w-[1240px] lg:scale-[0.72] lg:gap-10">
        {featureCloudRows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={`feature-cloud-row flex max-w-none items-center justify-center gap-x-7 gap-y-3 whitespace-nowrap sm:gap-x-9 lg:gap-x-11 ${row.className}`}
          >
            {row.words.map((word) => (
              <span
                key={word.label}
                className={`feature-cloud-word font-semibold leading-none text-white ${word.className}`}
              >
                {word.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BatteriesIncludedCloud() {
  return (
    <section className="batteries-cloud-section relative overflow-hidden border-t border-[var(--docs-border)] bg-black px-6 py-24 text-white sm:py-28 lg:min-h-[680px] lg:py-36">
      <FeatureWordCloud className="absolute inset-y-0 left-[28%] right-[-24vw] z-0 hidden lg:block" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden w-[62%] bg-gradient-to-r from-black via-black via-75% to-transparent lg:block" />

      <div className="relative z-10 mx-auto max-w-[1200px]">
        <div className="max-w-[410px]">
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
            Batteries included, battle-tested
          </h2>
          <p className="mb-5 text-base leading-relaxed text-white/58">
            Instead of starting from a blank prompt and a pile of improvised
            code, Agent-Native gives agents the battle-tested parts and best
            practices they need to build real app software.
          </p>
        </div>

        <FeatureWordCloud className="relative -mx-6 mt-12 h-[480px] sm:h-[560px] lg:hidden" />
      </div>
    </section>
  );
}

function TrySkillSection() {
  return (
    <section className="border-t border-[var(--docs-border)] px-6 py-16">
      <div className="mx-auto grid min-w-0 max-w-[1200px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)] lg:items-center">
        <div className="min-w-0">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Try it with a skill
          </h2>
          <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Add visual planning and PR recaps to Claude Code, Codex, Cursor, Pi,
            OpenCode, or VS Code with one command.
          </p>

          <CodeBlock code={skillInstallCode} lang="bash" />

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--docs-border)] p-5">
              <h3 className="mb-2 font-mono text-sm font-semibold text-[var(--docs-accent)]">
                /visual-plan
              </h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                Reviewable plans with diagrams, wireframes, file maps, and
                comments before code changes.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--docs-border)] p-5">
              <h3 className="mb-2 font-mono text-sm font-semibold text-[var(--docs-accent)]">
                /visual-recap
              </h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                A visual summary of a PR or diff so reviewers see the shape
                before the raw lines.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <Link
              data-an-prefetch="render"
              to="/docs/skills-guide"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
              onClick={() =>
                trackEvent("click cta", {
                  label: "skills_guide",
                  location: "skills_section",
                })
              }
            >
              Browse the Skills Guide
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </div>

        <AgentNativeDemoVideo className="aspect-square w-full" />
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <main className="docs-home-page">
        {/* Hero */}
        <section
          className="hero-section relative mx-auto flex min-h-[85vh] max-w-[1200px] items-center justify-center px-6"
          style={{ clipPath: "inset(-100vh -100vw 0 -100vw)" }}
        >
          <div
            className="pointer-events-none absolute bottom-0"
            style={{
              left: "50%",
              transform: "translateX(-50%)",
              width: "100vw",
              top: "-65px",
            }}
          >
            <Seascape className="opacity-[0.30] dark:opacity-[0.70]" />
          </div>
          <div
            className="pointer-events-none absolute inset-0 z-[5]"
            style={{
              background:
                "radial-gradient(ellipse at center, var(--bg) 0%, transparent 70%)",
              opacity: 0.5,
            }}
          />
          <div className="relative z-10 hero-content">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-4 py-1.5 text-sm text-[var(--fg-secondary)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--docs-accent)]" />
              Open source framework
            </div>

            <h1 className="mx-auto max-w-3xl">
              Agentic Applications <br className="hidden md:inline" />
              <span className="hero-gradient-text">You Own</span>
            </h1>

            <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-[var(--fg-secondary)]">
              Start with a chat-first app and the app-agent loop. Add actions,
              screens, jobs, and workflows as your agent grows.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                data-an-prefetch="render"
                to="/docs/getting-started"
                className="primary-button"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "start_chat_app",
                    location: "hero",
                  })
                }
              >
                Start with Chat
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
              <Link
                data-an-prefetch="render"
                to="/docs"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "view_docs",
                    location: "hero",
                  })
                }
              >
                View the Docs
              </Link>
            </div>

            <TerminalCommand />
          </div>
        </section>

        {/* Framework */}
        <section className="border-t border-[var(--docs-border)] px-6 py-20">
          <div className="mx-auto max-w-[1200px]">
            <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
              <div>
                <h2 className="mb-4 max-w-[370px] text-3xl font-bold tracking-tight md:text-4xl">
                  The framework for agent-native apps
                </h2>
                <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                  Agent-Native is an open-source framework for building agents
                  as real software: start with chat or headless agents, then add
                  UI, jobs, and collaboration around the same actions.
                </p>
                <p className="mb-6 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                  Bring your own database, hosting provider, model stack, and
                  app code.
                </p>
                <Link
                  data-an-prefetch="render"
                  to="/docs/what-is-agent-native"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                  onClick={() =>
                    trackEvent("click cta", {
                      label: "framework_guide",
                      location: "framework_section",
                    })
                  }
                >
                  Read the framework guide
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>

              <div className="min-w-0">
                <CodeBlock code={frameworkCode} lang="typescript" />
              </div>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {frameworkPrimitives.map((primitive) => {
                const PrimitiveIcon = primitive.icon;
                return (
                  <div
                    key={primitive.title}
                    className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5"
                  >
                    <div className="mb-2 flex items-center gap-3">
                      <PrimitiveIcon
                        className="size-4 shrink-0 text-[var(--docs-accent)]"
                        stroke={1.8}
                        aria-hidden="true"
                      />
                      <h3 className="m-0 text-base font-semibold">
                        {primitive.title}
                      </h3>
                    </div>
                    <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                      {primitive.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Templates */}
        <section
          id="templates"
          className="border-t border-[var(--docs-border)] py-20 px-6"
        >
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              Fork and customize a fully-featured app
            </h2>
            <p className="mb-3 text-sm font-semibold text-[var(--docs-accent)]">
              100% free and open source
            </p>
            <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
              When an action needs screens, start from a vetted app you can
              customize. Chat is the minimal app scaffold; domain templates add
              product workflows, example data, and agent-ready actions.
            </p>
          </div>

          <div className="templates-side-scroll mx-auto flex max-w-[1200px] snap-x snap-mandatory gap-5 overflow-x-auto pb-3">
            {homepageTemplates.map((t) => (
              <div
                key={t.name}
                className="template-rail-card w-[82vw] max-w-[360px] flex-[0_0_82vw] snap-start sm:w-[360px] sm:flex-[0_0_360px]"
              >
                <TemplateCard template={t} />
              </div>
            ))}
            <div className="template-rail-card template-rail-cta w-[82vw] max-w-[360px] flex-[0_0_82vw] snap-start sm:w-[360px] sm:flex-[0_0_360px]">
              <div className="feature-card flex flex-col justify-center bg-[var(--bg-secondary)]">
                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--docs-accent)]">
                  More templates
                </p>
                <h3 className="mb-3 text-2xl font-semibold tracking-tight">
                  Browse the full app shelf
                </h3>
                <p className="mb-6 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Start from chat, mail, forms, calendar, dispatch, assets,
                  brain, and more production-refined apps.
                </p>
                <Link
                  data-an-prefetch="render"
                  to="/templates"
                  className="primary-button w-full justify-center"
                  onClick={() =>
                    trackEvent("click cta", {
                      label: "view_all_templates",
                      location: "templates_scroll_end",
                    })
                  }
                >
                  View all templates
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link
              data-an-prefetch="render"
              to="/templates"
              className="primary-button"
              onClick={() =>
                trackEvent("click cta", {
                  label: "view_all_templates",
                  location: "templates_section",
                })
              }
            >
              View all templates
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </section>

        <BatteriesIncludedCloud />

        {/* Bidirectional Awareness */}
        <section className="border-t border-[var(--docs-border)] px-6 py-20">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              Agents and UIs — fully connected
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
              The agent and the UI are equal citizens of the same system. Every
              action works both ways — click it or ask for it.
            </p>
          </div>

          <div className="mx-auto max-w-[1200px]">
            <BidirectionalTabs />
          </div>
        </section>

        <TrySkillSection />

        <div className="mx-auto max-w-[1200px] px-6">
          {/* The best of both worlds */}
          <section className="border-t border-[var(--docs-border)] py-20">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                The best of both worlds
              </h2>
              <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
                SaaS tools are rigid and bolting AI on as an afterthought. Raw
                AI agents are powerful but have no UI. Agent-native apps combine
                both.
              </p>
            </div>

            <div className="approaches-table-outer">
              <div className="approaches-table-wrapper">
                <div className="approaches-table-scroll">
                  <table className="approaches-table">
                    <thead>
                      <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                        <th className="approaches-th approaches-col-dim"></th>
                        <th className="approaches-th approaches-col-muted">
                          SaaS Tools
                        </th>
                        <th className="approaches-th approaches-col-muted">
                          Raw AI Agents
                        </th>
                        <th className="approaches-th approaches-col-muted">
                          Internal Tools
                        </th>
                        <th className="approaches-th">Agent-Native</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">UI</td>
                        <td className="approaches-td approaches-td--good">
                          Polished but rigid
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          None
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          Mixed quality
                        </td>
                        <td className="approaches-td approaches-td--good">
                          Full UI, fork &amp; go
                        </td>
                      </tr>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">AI</td>
                        <td className="approaches-td approaches-td--bad">
                          Bolted on
                        </td>
                        <td className="approaches-td approaches-td--good">
                          Powerful
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          Shallowly connected
                        </td>
                        <td className="approaches-td approaches-td--good">
                          Agent-first, integrated
                        </td>
                      </tr>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">
                          Customization
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          Can't
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          Instructions and skills
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          Full, but high maintenance
                        </td>
                        <td className="approaches-td approaches-td--good">
                          Agent modifies the app
                        </td>
                      </tr>
                      <tr>
                        <td className="approaches-td approaches-td--dim">
                          Ownership
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          Rented
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          Somewhat yours
                        </td>
                        <td className="approaches-td approaches-td--good">
                          You own the code
                        </td>
                        <td className="approaches-td approaches-td--good">
                          You own the code
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* Quick Start */}
          <section className="border-t border-[var(--docs-border)] py-20">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                Start with Chat
              </h2>
              <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
                One command creates a local chat app backed by actions, durable
                threads, and SQLite. Use `--headless` instead when you want no
                browser UI yet.
              </p>
            </div>

            <div className="mx-auto max-w-2xl">
              <CodeBlock code={quickStartCode} lang="bash" />
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="border-t border-[var(--docs-border)] py-20 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              Software you own, built for the agentic era
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
              Start with chat or a durable action, run it through the app-agent
              loop, then grow it into UI, jobs, and collaboration without
              rewriting the operation. Open source. Forkable. Yours.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                data-an-prefetch="render"
                to="/docs/getting-started"
                className="primary-button"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "start_with_action",
                    location: "footer",
                  })
                }
              >
                Start with an Action
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
              <Link
                data-an-prefetch="render"
                to="/docs"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "read_the_docs",
                    location: "footer",
                  })
                }
              >
                Read the Docs
              </Link>
              <a
                href="https://github.com/BuilderIO/agent-native"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "github",
                    location: "footer",
                  })
                }
              >
                View on GitHub
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
