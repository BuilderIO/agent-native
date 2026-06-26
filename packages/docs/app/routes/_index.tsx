import { useLocale, useT } from "@agent-native/core/client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { AgentNativeDemoVideo } from "../components/AgentNativeDemoVideo";
import CodeBlock from "../components/CodeBlock";
import { sitePathForLocale } from "../components/docs-locale";
import Seascape from "../components/Seascape";
import {
  featuredTemplates,
  TemplateCard,
  trackEvent,
} from "../components/TemplateCard";

function TerminalCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

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

const BIDIRECTIONAL_TABS = [
  {
    key: "agentSees",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa7b4e0fca8154ab6a82414178d3a4521%2Fcompressed?token=a7b4e0fca8154ab6a82414178d3a4521&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    key: "uiTalks",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F02f0369cc97345aa89311d0909b24611%2Fcompressed?token=02f0369cc97345aa89311d0909b24611&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    key: "agentUpdates",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1aade099ff6d4e9ca04f8534d3314383%2Fcompressed?token=1aade099ff6d4e9ca04f8534d3314383&alt=media&optimized=true", // ggignore: public Builder CDN media token
  },
  {
    key: "everything",
    video:
      "https://cdn.builder.io/o/assets%2FYJIGb4i01jvw0SRdL5Bt%2F39c6b297895843708938b097d8e3eb2c?alt=media&token=c5fdf84c-d4fb-45b0-b220-ef7aab01e99f", // ggignore: public Builder CDN media token
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
        labelKey: "notifications",
        className: "text-base uppercase opacity-[0.18]",
      },
      {
        labelKey: "recurringJobs",
        className: "text-lg uppercase opacity-[0.22]",
      },
      { labelKey: "actions", className: "text-5xl opacity-[0.95]" },
      {
        labelKey: "agentTeams",
        className: "text-xl uppercase opacity-[0.22]",
      },
      {
        labelKey: "monorepos",
        className: "text-lg uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "translate-x-12",
    words: [
      {
        labelKey: "permissions",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "rbac", className: "text-lg uppercase opacity-[0.18]" },
      { labelKey: "organizations", className: "text-2xl opacity-[0.24]" },
      {
        labelKey: "workspaceSecrets",
        className: "text-lg uppercase opacity-[0.16]",
      },
      { labelKey: "docsSearch", className: "text-xl uppercase opacity-[0.18]" },
      {
        labelKey: "sourceSearch",
        className: "text-xl uppercase opacity-[0.18]",
      },
    ],
  },
  {
    className: "translate-x-8",
    words: [
      {
        labelKey: "contextAwareness",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "observability", className: "text-4xl opacity-[0.86]" },
      {
        labelKey: "realtimeSync",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { labelKey: "sqlState", className: "text-4xl opacity-[0.86]" },
      {
        labelKey: "multiTenancy",
        className: "text-xl uppercase opacity-[0.22]",
      },
      {
        labelKey: "dataLoaders",
        className: "text-lg uppercase opacity-[0.18]",
      },
      {
        labelKey: "liveQueries",
        className: "text-xl uppercase opacity-[0.18]",
      },
    ],
  },
  {
    className: "-translate-x-14",
    words: [
      {
        labelKey: "agentInstructions",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "providerGrants",
        className: "text-lg uppercase opacity-[0.16]",
      },
      { labelKey: "notifications", className: "text-2xl opacity-[0.24]" },
      { labelKey: "comments", className: "text-xl uppercase opacity-[0.18]" },
      {
        labelKey: "reviewLinks",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "privacyControls",
        className: "text-lg uppercase opacity-[0.16]",
      },
    ],
  },
  {
    className: "-translate-x-4",
    words: [
      {
        labelKey: "skills",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { labelKey: "security", className: "text-3xl opacity-[0.58]" },
      { labelKey: "auditLogs", className: "text-3xl opacity-[0.54]" },
      { labelKey: "workspaces", className: "text-3xl opacity-[0.46]" },
      {
        labelKey: "voiceInput",
        className: "text-lg uppercase opacity-[0.18]",
      },
      {
        labelKey: "mcpApps",
        className: "text-xl uppercase opacity-[0.20]",
      },
      { labelKey: "generativeUi", className: "text-4xl opacity-[0.76]" },
      { labelKey: "toolCalls", className: "text-2xl opacity-[0.26]" },
      {
        labelKey: "agentSidebar",
        className: "text-xl uppercase opacity-[0.18]",
      },
    ],
  },
  {
    className: "feature-cloud-center-row",
    words: [
      { labelKey: "sharedActions", className: "text-2xl opacity-[0.30]" },
      { labelKey: "uiSurfaces", className: "text-xl uppercase opacity-[0.20]" },
      { labelKey: "i18n", className: "text-5xl opacity-[0.92]" },
      { labelKey: "mcpAuth", className: "text-2xl opacity-[0.44]" },
      {
        labelKey: "battleTestedComponents",
        className:
          "feature-cloud-center-card max-w-[260px] whitespace-normal rounded-2xl border border-neutral-300 bg-neutral-100 px-6 py-5 text-center text-2xl text-neutral-950 opacity-100 shadow-[0_18px_70px_rgba(255,255,255,0.92)] dark:border-white/30 dark:bg-[#151515] dark:text-white dark:shadow-[0_18px_70px_rgba(0,0,0,0.96)] sm:max-w-[310px] sm:px-8 sm:py-6 sm:text-3xl",
      },
      { labelKey: "mcpA2a", className: "text-5xl opacity-[0.92]" },
      { labelKey: "externalAgents", className: "text-2xl opacity-[0.32]" },
      {
        labelKey: "a2aHandoffs",
        className: "text-xl uppercase opacity-[0.20]",
      },
    ],
  },
  {
    className: "translate-x-6",
    words: [
      {
        labelKey: "humanHandoff",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "agentContext", className: "text-2xl opacity-[0.26]" },
      {
        labelKey: "durableResume",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "extensions", className: "text-3xl opacity-[0.48]" },
      { labelKey: "sharingPrivacy", className: "text-2xl opacity-[0.34]" },
      {
        labelKey: "realTimeCollaboration",
        className: "text-2xl opacity-[0.30]",
      },
      { labelKey: "sso", className: "text-2xl opacity-[0.44]" },
      {
        labelKey: "oauth",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { labelKey: "mcpServers", className: "text-2xl opacity-[0.28]" },
      { labelKey: "agentTeams", className: "text-xl uppercase opacity-[0.18]" },
    ],
  },
  {
    className: "-translate-x-8",
    words: [
      {
        labelKey: "scopedAccess",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "dbAdapters",
        className: "text-lg uppercase opacity-[0.22]",
      },
      { labelKey: "auth", className: "text-4xl opacity-[0.84]" },
      { labelKey: "approvals", className: "text-3xl opacity-[0.44]" },
      { labelKey: "automations", className: "text-3xl opacity-[0.46]" },
      { labelKey: "governance", className: "text-3xl opacity-[0.48]" },
      { labelKey: "jobs", className: "text-4xl opacity-[0.84]" },
      {
        labelKey: "agUi",
        className: "text-lg uppercase opacity-[0.20]",
      },
      { labelKey: "dispatch", className: "text-2xl opacity-[0.28]" },
      {
        labelKey: "backgroundRuns",
        className: "text-xl uppercase opacity-[0.18]",
      },
    ],
  },
  {
    className: "translate-x-4",
    words: [
      { labelKey: "rateLimits", className: "text-lg uppercase opacity-[0.16]" },
      { labelKey: "queues", className: "text-xl uppercase opacity-[0.18]" },
      {
        labelKey: "cronSchedules",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "analytics", className: "text-2xl opacity-[0.28]" },
      {
        labelKey: "experiments",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "feedbackLoops",
        className: "text-lg uppercase opacity-[0.16]",
      },
    ],
  },
  {
    className: "translate-x-12",
    words: [
      {
        labelKey: "fileUploads",
        className: "text-xl uppercase opacity-[0.20]",
      },
      { labelKey: "evals", className: "text-2xl opacity-[0.46]" },
      { labelKey: "templates", className: "text-5xl opacity-[0.92]" },
      { labelKey: "providerApis", className: "text-2xl opacity-[0.36]" },
      {
        labelKey: "agentWebSurfaces",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "templateSkills",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "oneClickForks", className: "text-2xl opacity-[0.24]" },
    ],
  },
  {
    className: "-translate-x-2",
    words: [
      {
        labelKey: "localFileMode",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "memory",
        className: "text-lg uppercase opacity-[0.18]",
      },
      {
        labelKey: "webhooks",
        className: "text-xl uppercase opacity-[0.22]",
      },
      {
        labelKey: "http",
        className: "text-xl uppercase opacity-[0.20]",
      },
      {
        labelKey: "selfEditingCode",
        className: "text-lg uppercase opacity-[0.16]",
      },
      {
        labelKey: "cli",
        className: "text-xl uppercase opacity-[0.24]",
      },
      {
        labelKey: "crossAppSso",
        className: "text-lg uppercase opacity-[0.16]",
      },
    ],
  },
  {
    className: "translate-x-16",
    words: [
      {
        labelKey: "schemaMigrations",
        className: "text-lg uppercase opacity-[0.16]",
      },
      {
        labelKey: "hostedDeploys",
        className: "text-xl uppercase opacity-[0.18]",
      },
      {
        labelKey: "environmentSetup",
        className: "text-lg uppercase opacity-[0.16]",
      },
      {
        labelKey: "oauthCallbacks",
        className: "text-xl uppercase opacity-[0.18]",
      },
      { labelKey: "exports", className: "text-xl uppercase opacity-[0.18]" },
      { labelKey: "dashboards", className: "text-2xl opacity-[0.24]" },
    ],
  },
];

function FeatureWordCloud({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div
      className={`feature-cloud pointer-events-none overflow-hidden bg-white dark:bg-black ${className}`}
      aria-hidden="true"
    >
      <div className="feature-cloud-flow absolute left-1/2 top-1/2 flex w-[860px] -translate-x-1/2 -translate-y-1/2 scale-[0.82] flex-col items-center gap-6 px-8 sm:w-[1080px] sm:scale-[0.78] sm:gap-8 lg:w-[1740px] lg:scale-[0.68] lg:gap-10">
        {featureCloudRows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={`feature-cloud-row flex max-w-none items-center justify-center gap-x-7 gap-y-3 whitespace-nowrap sm:gap-x-9 lg:gap-x-11 ${row.className}`}
          >
            {row.words.map((word) => (
              <span
                key={word.labelKey}
                className={`feature-cloud-word font-semibold leading-none text-neutral-950 dark:text-white ${word.className}`}
              >
                {t(`home.featureCloud.${word.labelKey}`)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BatteriesIncludedCloud() {
  const t = useT();
  return (
    <section className="batteries-cloud-section relative overflow-hidden border-t border-[var(--docs-border)] bg-white px-6 py-24 text-neutral-950 dark:bg-black dark:text-white sm:py-28 lg:flex lg:min-h-[680px] lg:items-center lg:py-36">
      <FeatureWordCloud className="absolute inset-y-0 left-[-10vw] right-[-26vw] z-0 hidden translate-x-[140px] lg:block" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden w-[46%] bg-gradient-to-r from-white/90 via-white/68 via-70% to-transparent dark:from-black/90 dark:via-black/68 lg:block" />

      <div className="relative z-10 mx-auto w-full max-w-[1200px]">
        <div className="max-w-[410px] text-center lg:text-left">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-neutral-950 dark:text-white md:text-4xl">
            {t("home.batteries.titleLine1")}
            <span className="block">{t("home.batteries.titleLine2")}</span>
          </h2>
          <p className="mx-auto mb-5 max-w-[350px] text-base leading-relaxed text-neutral-600 dark:text-white/58 lg:mx-0">
            {t("home.batteries.body")}
          </p>
        </div>

        <FeatureWordCloud className="relative -mx-6 mt-12 h-[480px] sm:h-[560px] lg:hidden" />
      </div>
    </section>
  );
}

function BidirectionalTabs() {
  const t = useT();
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
      return (i + 1) % BIDIRECTIONAL_TABS.length;
    });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <div
        ref={tabContainerRef}
        className="flex shrink-0 flex-row gap-2 overflow-x-auto px-1 py-1 md:w-1/4 md:flex-col md:gap-3 md:overflow-visible md:p-0"
      >
        {BIDIRECTIONAL_TABS.map((tab, i) => (
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
              {t(`home.connected.tabs.${tab.key}.title`)}
            </div>
            <p
              className={`m-0 text-sm leading-relaxed text-[var(--fg-secondary)] ${
                i === activeTab ? "hidden md:block" : "hidden"
              }`}
            >
              {t(`home.connected.tabs.${tab.key}.description`)}
            </p>
          </button>
        ))}
      </div>
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-[var(--docs-border)] bg-black md:w-3/4">
        {BIDIRECTIONAL_TABS.map((tab, i) => (
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
  const t = useT();
  const { locale } = useLocale();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);
  const chatCommand = "npx @agent-native/core@latest create my-app";
  const quickStartCode = `# ${t("home.code.quickStartComment")}
${chatCommand}
cd my-app
pnpm install
pnpm action hello --name Builder
pnpm agent "Call hello for Builder"`;
  const skillInstallCode = `# ${t("home.code.skillInstallComment")}
npx @agent-native/core@latest skills add visual-plan`;
  const frameworkCode = `// ${t("home.code.frameworkComment")}
export default defineAction({
  description: "${t("home.code.frameworkDescription")}",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => ({ message: \`Hello, \${name}!\` }),
});`;

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
              {t("home.hero.badge")}
            </div>

            <h1 className="mx-auto max-w-3xl">
              {t("home.hero.titleLine1")} <br className="hidden md:inline" />
              <span className="hero-gradient-text">
                {t("home.hero.titleAccent")}
              </span>
            </h1>

            <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-[var(--fg-secondary)]">
              {t("home.hero.body")}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                data-an-prefetch="render"
                to={localizedPath("/templates")}
                className="primary-button"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "start_with_template",
                    location: "hero",
                  })
                }
              >
                {t("home.hero.primaryCta")}
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
                to={localizedPath("/docs")}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "view_docs",
                    location: "hero",
                  })
                }
              >
                {t("home.hero.secondaryCta")}
              </Link>
            </div>

            <TerminalCommand command={chatCommand} />
          </div>
        </section>

        {/* Framework */}
        <section className="border-t border-[var(--docs-border)] px-6 py-28 lg:py-36">
          <div className="mx-auto max-w-[1200px]">
            <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
              <div>
                <h2 className="mb-4 max-w-[370px] text-3xl font-bold tracking-tight md:text-4xl">
                  {t("home.framework.title")}
                </h2>
                <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                  {t("home.framework.body1")}
                </p>
                <p className="mb-6 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                  {t("home.framework.body2")}
                </p>
                <Link
                  data-an-prefetch="render"
                  to={localizedPath("/docs/what-is-agent-native")}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                  onClick={() =>
                    trackEvent("click cta", {
                      label: "framework_guide",
                      location: "framework_section",
                    })
                  }
                >
                  {t("home.framework.cta")}
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
          </div>
        </section>

        {/* Templates - breaks out of max-width on ultra-wide screens */}
        <section
          id="templates"
          className="border-t border-[var(--docs-border)] py-20 px-6"
        >
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              {t("home.templates.title")}
            </h2>
            <p className="mb-3 text-sm font-semibold text-[var(--docs-accent)]">
              {t("home.templates.eyebrow")}
            </p>
            <div className="mt-8">
              <Link
                data-an-prefetch="render"
                to={localizedPath("/templates")}
                className="primary-button"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "view_all_templates",
                    location: "templates_section_header",
                  })
                }
              >
                {t("home.templates.cta")}
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

          <div className="templates-side-scroll -mx-6 flex snap-x gap-5 overflow-x-auto overflow-y-hidden px-8 pb-3 pl-10 [scroll-padding-left:2.5rem]">
            {homepageTemplates.map((template) => (
              <div
                key={template.name}
                className="template-rail-card w-[320px] shrink-0 snap-start scroll-ml-10 sm:w-[360px]"
              >
                <TemplateCard template={template} />
              </div>
            ))}
            <div className="template-rail-card template-rail-cta w-[320px] shrink-0 snap-start scroll-ml-10 sm:w-[360px]">
              <Link
                data-an-prefetch="render"
                to={localizedPath("/templates")}
                className="flex min-h-full w-full flex-col items-center justify-center gap-5 px-6 py-8 text-center no-underline hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "view_all_templates",
                    location: "templates_scroll_end",
                  })
                }
              >
                <div>
                  <h3 className="mb-3 text-2xl font-semibold tracking-tight text-[var(--fg)]">
                    {t("home.templates.cta")}
                  </h3>
                </div>
                <span className="primary-button">
                  {t("home.templates.cta")}
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
                </span>
              </Link>
            </div>
          </div>
        </section>

        <BatteriesIncludedCloud />

        {/* Try it with a skill */}
        <section className="border-t border-[var(--docs-border)] px-6 py-16">
          <div className="mx-auto grid min-w-0 max-w-[1200px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.82fr)] lg:items-center">
            <div className="min-w-0">
              <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
                {t("home.skills.title")}
              </h2>
              <p className="mb-5 max-w-xl text-base leading-relaxed text-[var(--fg-secondary)]">
                {t("home.skills.body")}
              </p>

              <CodeBlock code={skillInstallCode} lang="bash" />

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--docs-border)] p-5">
                  <h3 className="mb-2 font-mono text-sm font-semibold text-[var(--docs-accent)]">
                    /visual-plan
                  </h3>
                  <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                    {t("home.skills.planBody")}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--docs-border)] p-5">
                  <h3 className="mb-2 font-mono text-sm font-semibold text-[var(--docs-accent)]">
                    /visual-recap
                  </h3>
                  <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                    {t("home.skills.recapBody")}
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <Link
                  data-an-prefetch="render"
                  to={localizedPath("/docs/skills-guide")}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-5 py-2.5 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                  onClick={() =>
                    trackEvent("click cta", {
                      label: "skills_guide",
                      location: "skills_section",
                    })
                  }
                >
                  {t("home.skills.cta")}
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
              {t("home.connected.title")}
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
              {t("home.connected.body")}
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
                {t("home.comparison.title")}
              </h2>
              <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
                {t("home.comparison.body")}
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
                          {t("home.comparison.columns.saas")}
                        </th>
                        <th className="approaches-th approaches-col-muted">
                          {t("home.comparison.columns.agents")}
                        </th>
                        <th className="approaches-th approaches-col-muted">
                          {t("home.comparison.columns.internal")}
                        </th>
                        <th className="approaches-th">
                          {t("home.comparison.columns.native")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">
                          {t("home.comparison.rows.ui")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.polishedButRigid")}
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          {t("home.comparison.cells.none")}
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          {t("home.comparison.cells.mixedQuality")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.fullUi")}
                        </td>
                      </tr>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">
                          {t("home.comparison.rows.ai")}
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          {t("home.comparison.cells.boltedOn")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.powerful")}
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          {t("home.comparison.cells.shallowlyConnected")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.agentFirst")}
                        </td>
                      </tr>
                      <tr className="border-b border-[var(--docs-border)]">
                        <td className="approaches-td approaches-td--dim">
                          {t("home.comparison.rows.customization")}
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          {t("home.comparison.cells.cant")}
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          {t("home.comparison.cells.instructionsAndSkills")}
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          {t("home.comparison.cells.fullHighMaintenance")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.agentModifies")}
                        </td>
                      </tr>
                      <tr>
                        <td className="approaches-td approaches-td--dim">
                          {t("home.comparison.rows.ownership")}
                        </td>
                        <td className="approaches-td approaches-td--bad">
                          {t("home.comparison.cells.rented")}
                        </td>
                        <td className="approaches-td approaches-td--warn">
                          {t("home.comparison.cells.somewhatYours")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.youOwnCode")}
                        </td>
                        <td className="approaches-td approaches-td--good">
                          {t("home.comparison.cells.youOwnCode")}
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
                {t("home.quickStart.title")}
              </h2>
              <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
                {t("home.quickStart.body")}
              </p>
            </div>

            <div className="mx-auto max-w-2xl">
              <CodeBlock code={quickStartCode} lang="bash" />
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="border-t border-[var(--docs-border)] py-20 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
              {t("home.finalCta.title")}
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
              {t("home.finalCta.body")}
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                data-an-prefetch="render"
                to={localizedPath("/docs/getting-started")}
                className="primary-button"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "start_with_action",
                    location: "footer",
                  })
                }
              >
                {t("home.finalCta.primaryCta")}
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
                to={localizedPath("/docs")}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
                onClick={() =>
                  trackEvent("click cta", {
                    label: "read_the_docs",
                    location: "footer",
                  })
                }
              >
                {t("home.finalCta.secondaryCta")}
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
                {t("home.finalCta.githubCta")}
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
