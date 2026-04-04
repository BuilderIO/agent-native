import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import CodeBlock from "../components/CodeBlock";
import Seascape from "../components/Seascape";
import {
  templates,
  TemplateCard,
  trackEvent,
} from "../components/TemplateCard";

const quickStartCode = `# Fork a template and start building
npx @agent-native/core create my-app --template mail
cd my-app
pnpm install
pnpm dev`;

function TerminalCommand() {
  const [copied, setCopied] = useState(false);
  const command = "npx @agent-native/core create my-app";

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    trackEvent("copy_cli_command", { location: "hero" });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="group mx-auto mt-8 flex items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-5 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)]"
    >
      <span className="text-[var(--fg-secondary)]">$</span>
      <span className="terminal-command-text text-[var(--fg)]">{command}</span>
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
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa7b4e0fca8154ab6a82414178d3a4521%2Fcompressed?apiKey=YJIGb4i01jvw0SRdL5Bt&token=a7b4e0fca8154ab6a82414178d3a4521&alt=media&optimized=true",
  },
  {
    title: "The UI talks to the agent",
    description:
      "Buttons, forms, and workflows push structured content to the agent, giving you guided flows that all go through the agent — including skills, rules, and instructions.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F02f0369cc97345aa89311d0909b24611%2Fcompressed?apiKey=YJIGb4i01jvw0SRdL5Bt&token=02f0369cc97345aa89311d0909b24611&alt=media&optimized=true",
  },
  {
    title: "The agent updates its own code",
    description:
      "It can modify the app itself to change features and functionality. Your tools get better over time.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1aade099ff6d4e9ca04f8534d3314383%2Fcompressed?apiKey=YJIGb4i01jvw0SRdL5Bt&token=1aade099ff6d4e9ca04f8534d3314383&alt=media&optimized=true",
  },
  {
    title: "Everything works both ways",
    description:
      "Every action available in the UI is also available to the agent. You can click to do something, or ask the agent to do it.",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F39c6b297895843708938b097d8e3eb2c?alt=media&token=c5fdf84c-d4fb-45b0-b220-ef7aab01e99f&apiKey=YJIGb4i01jvw0SRdL5Bt",
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
        video.play();
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
                ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-[0_0_0_1px_var(--accent)]"
                : "border-[var(--border)] hover:border-[var(--fg-secondary)]/40"
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
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black md:w-3/4">
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
      <main>
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
          <div className="relative z-10">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-1.5 text-sm text-[var(--fg-secondary)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
              Open source framework
            </div>

            <h1 className="mx-auto max-w-3xl">
              Agentic Apps That{" "}
              <span className="hero-gradient-text">Self Improve</span>
            </h1>

            <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-[var(--fg-secondary)]">
              Don't choose between structured user flows and autonomous agents.
              Every Agent-Native app is both.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="#templates"
                className="primary-button"
                onClick={() =>
                  trackEvent("click_cta", {
                    label: "launch_a_template",
                    location: "hero",
                  })
                }
              >
                Launch a Template
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
              </a>
              <a
                href="https://github.com/BuilderIO/agent-native"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click_cta", { label: "github", location: "hero" })
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                GitHub
              </a>
            </div>

            <TerminalCommand />
          </div>
        </section>

        {/* Bidirectional Awareness - above templates */}
        <section className="py-20 px-6 border-t border-[var(--border)]">
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

        {/* Templates - breaks out of max-width on ultra-wide screens */}
        <section id="templates" className="py-20 px-6">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              Start with a full featured template
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
              High-quality, vetted templates that replace tools you're paying
              for — except you own the code and can customize everything. Try
              them with example data before connecting your own sources.
            </p>
          </div>

          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <TemplateCard key={t.name} template={t} />
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              prefetch="render"
              to="/templates"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
              onClick={() =>
                trackEvent("click_cta", {
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

        <div className="mx-auto max-w-[1200px] px-6">
          {/* The best of both worlds */}
          <section className="border-t border-[var(--border)] py-20">
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
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
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
                      <tr className="border-b border-[var(--border)]">
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
                      <tr className="border-b border-[var(--border)]">
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
                      <tr className="border-b border-[var(--border)]">
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

          {/* Value props */}
          <section className="border-t border-[var(--border)] py-20">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                How it works
              </h2>
              <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
                The agent and the UI are equal partners out of the box.
                Everything the UI can do, the agent can do — and vice versa.
              </p>
            </div>

            <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">
                  Everything syncs
                </h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Agent and UI share one database and one state. Changes from
                  either side show up instantly on the other.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">Context-aware</h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  The agent knows what you're looking at. Select text, hit
                  Cmd+I, and tell it what to do.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">
                  Agents call agents
                </h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Tag another agent from any app. They discover each other over
                  A2A and take action across your stack.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">
                  Any database, any host
                </h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Any SQL database Drizzle supports. Any hosting target Nitro
                  supports. No lock-in.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">Any AI agent</h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Claude Code, Codex, Gemini CLI, OpenCode, or Builder.io. Use
                  whichever agent you prefer.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-6">
                <h3 className="mb-2 text-base font-semibold">
                  Apps that improve themselves
                </h3>
                <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                  Your apps get better on their own. The agent can add features,
                  fix bugs, and refine the UI over time.
                </p>
              </div>
            </div>
          </section>

          {/* Quick Start */}
          <section className="border-t border-[var(--border)] py-20">
            <div className="mb-12 text-center">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                Launch in minutes
              </h2>
              <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
                One command to fork a template and start building locally.
              </p>
            </div>

            <div className="mx-auto max-w-2xl">
              <CodeBlock code={quickStartCode} lang="bash" />
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="border-t border-[var(--border)] py-20 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              Software you own, built for the agentic era
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
              Stop renting rigid SaaS. Fork a template, customize it to your
              exact workflow, and let the agent keep evolving it. Open source.
              Forkable. Yours.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="#templates"
                className="primary-button"
                onClick={() =>
                  trackEvent("click_cta", {
                    label: "launch_a_template",
                    location: "footer",
                  })
                }
              >
                Launch a Template
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
              </a>
              <Link
                prefetch="render"
                to="/docs"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click_cta", {
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
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click_cta", {
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
