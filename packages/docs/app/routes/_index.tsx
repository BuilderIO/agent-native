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
            <Seascape className="opacity-30 dark:opacity-70" />
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
                <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                  It gives you primitives for product-grade agentic software:
                  shared actions, SQL-backed state, identity, tools, skills,
                  jobs, observability, and UI surfaces that all work together.
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

        {/* Templates - breaks out of max-width on ultra-wide screens */}
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

          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {homepageTemplates.map((t) => (
              <TemplateCard key={t.name} template={t} />
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              data-an-prefetch="render"
              to="/templates"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
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

        {/* Try it with a skill */}
        <section className="border-t border-[var(--docs-border)] px-6 py-16">
          <div className="mx-auto grid min-w-0 max-w-[1200px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)] lg:items-center">
            <div className="min-w-0">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                Try it with a skill
              </h2>
              <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                Add visual planning and PR recaps to Claude Code, Codex, Cursor,
                Pi, OpenCode, or VS Code with one command.
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
