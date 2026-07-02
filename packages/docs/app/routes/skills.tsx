import {
  normalizeLocaleCode,
  trackEvent,
  useLocale,
  useT,
} from "@agent-native/core/client";
import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router";

import { AgentNativeDemoVideo } from "../components/AgentNativeDemoVideo";
import { sitePathForLocale } from "../components/docs-locale";
import arSA from "../i18n/ar-SA";
import deDE from "../i18n/de-DE";
import enUS from "../i18n/en-US";
import esES from "../i18n/es-ES";
import frFR from "../i18n/fr-FR";
import hiIN from "../i18n/hi-IN";
import jaJP from "../i18n/ja-JP";
import koKR from "../i18n/ko-KR";
import ptBR from "../i18n/pt-BR";
import zhCN from "../i18n/zh-CN";
import zhTW from "../i18n/zh-TW";
import { withDefaultSocialImage } from "../seo";

const SKILLS_PAGE_META = {
  "ar-SA": arSA.skillsPage,
  "de-DE": deDE.skillsPage,
  "en-US": enUS.skillsPage,
  "es-ES": esES.skillsPage,
  "fr-FR": frFR.skillsPage,
  "hi-IN": hiIN.skillsPage,
  "ja-JP": jaJP.skillsPage,
  "ko-KR": koKR.skillsPage,
  "pt-BR": ptBR.skillsPage,
  "zh-CN": zhCN.skillsPage,
  "zh-TW": zhTW.skillsPage,
};

export const meta = ({ params }: { params?: { locale?: string } } = {}) => {
  const locale = normalizeLocaleCode(params?.locale) ?? "en-US";
  const copy = SKILLS_PAGE_META[locale] ?? enUS.skillsPage;

  return withDefaultSocialImage([
    {
      title: copy.metaTitle,
    },
    {
      name: "description",
      content: copy.metaDescription,
    },
    {
      property: "og:title",
      content: copy.metaTitle,
    },
    {
      property: "og:description",
      content: copy.metaOgDescription,
    },
    {
      name: "keywords",
      content: copy.metaKeywords,
    },
  ]);
};

const INSTALL_COMMAND = "npx @agent-native/core@latest skills add";

type Skill = {
  command: string;
  copyKey: "visualPlan" | "visualRecap" | "visualEdit";
  docsTo: string;
  videoUrl?: string;
};

const SKILLS: Skill[] = [
  {
    command: "/visual-plan",
    copyKey: "visualPlan",
    docsTo: "/docs/template-plan",
    videoUrl: import.meta.env.VITE_VISUAL_PLAN_SKILL_DEMO_VIDEO_URL,
  },
  {
    command: "/visual-recap",
    copyKey: "visualRecap",
    docsTo: "/docs/pr-visual-recap",
    videoUrl: import.meta.env.VITE_VISUAL_RECAP_SKILL_DEMO_VIDEO_URL,
  },
  {
    command: "/visual-edit",
    copyKey: "visualEdit",
    docsTo: "/docs/template-design",
    videoUrl: import.meta.env.VITE_VISUAL_EDIT_SKILL_DEMO_VIDEO_URL,
  },
];

function CliCopy({
  command,
  location,
  className = "",
}: {
  command: string;
  location: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    trackEvent("copy cli command", { skill: "visual-plan", location });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className={`group flex w-full min-w-0 items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:px-5 ${className}`}
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span className="min-w-0 truncate text-left text-[var(--fg)]">
        {command}
      </span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
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

function SkillVideo({ skill }: { skill: Skill }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const t = useT();
  if (!skill.videoUrl) return null;

  function handleVideoReady(event: SyntheticEvent<HTMLVideoElement>) {
    setIsLoaded(true);
    void event.currentTarget.play().catch(() => {
      // Muted autoplay can still be blocked by browser settings.
    });
  }

  return (
    <div className="relative mt-5 aspect-[1189/1080] overflow-hidden rounded-lg border border-[var(--docs-border)] bg-black">
      <video
        src={skill.videoUrl}
        aria-label={t(`skillsPage.${skill.copyKey}.videoAriaLabel`)}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onCanPlay={handleVideoReady}
        onLoadedData={handleVideoReady}
        onPlaying={() => setIsLoaded(true)}
        className="block h-full w-full object-cover"
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-[var(--bg-secondary)] transition-opacity duration-300 ${
          isLoaded ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex h-full w-full animate-pulse flex-col justify-between p-4">
          <div className="space-y-2">
            <div className="h-3 w-1/3 rounded-full bg-[var(--docs-border)]" />
            <div className="h-2.5 w-2/3 rounded-full bg-[var(--docs-border)]" />
          </div>
          <div className="grid gap-2">
            <div className="h-16 rounded-md bg-[var(--docs-border)]/70 sm:h-20" />
            <div className="h-8 rounded-md bg-[var(--docs-border)]/50 sm:h-10" />
          </div>
          <div className="h-7 w-1/4 rounded-full bg-[var(--docs-border)]" />
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: Skill }) {
  const { locale } = useLocale();
  const t = useT();
  const featureKeys = ["feature1", "feature2"] as const;

  return (
    <article className="flex flex-col rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-2 py-1 font-mono text-sm text-[var(--fg)]">
          {skill.command}
        </span>
        <span className="text-sm text-[var(--fg-secondary)]">
          {t(`skillsPage.${skill.copyKey}.tagline`)}
        </span>
      </div>

      <h3 className="mb-2 text-lg font-semibold tracking-tight">
        {t(`skillsPage.${skill.copyKey}.name`)}
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {t(`skillsPage.${skill.copyKey}.description`)}
      </p>

      <ul className="m-0 mb-4 list-disc space-y-1.5 pl-5 text-sm text-[var(--fg-secondary)]">
        {featureKeys.map((featureKey) => (
          <li key={featureKey}>
            {t(`skillsPage.${skill.copyKey}.${featureKey}`)}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-4 pt-1">
        <Link
          data-an-prefetch="render"
          to={sitePathForLocale(skill.docsTo, locale)}
          onClick={() =>
            trackEvent("skill read docs", {
              skill: skill.command,
              location: "skills_card",
            })
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
        >
          {t("common.readDocs")}
          <span aria-hidden>→</span>
        </Link>
      </div>

      {skill.videoUrl ? <SkillVideo skill={skill} /> : null}
    </article>
  );
}

export default function SkillsPage() {
  const { locale } = useLocale();
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  return (
    <main className="mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:items-center lg:gap-12">
          <div>
            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              {t("skillsPage.heroTitle")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("skillsPage.heroBody")}
            </p>

            <CliCopy command={INSTALL_COMMAND} location="skills_hero" />
          </div>

          <AgentNativeDemoVideo className="aspect-square w-full" />
        </div>
      </section>

      {/* Skill cards */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("skillsPage.sectionTitle")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("skillsPage.sectionBody")}
        </p>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SKILLS.map((skill) => (
            <SkillCard key={skill.command} skill={skill} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          {t("skillsPage.ctaBody")}
        </p>
        <div className="mx-auto max-w-xl">
          <CliCopy command={INSTALL_COMMAND} location="skills_cta" />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <Link
            data-an-prefetch="render"
            to={localizedPath("/docs/template-plan")}
            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--fg)] no-underline hover:text-[var(--docs-accent)]"
          >
            {t("skillsPage.readVisualPlansDocs")}
            <span aria-hidden>→</span>
          </Link>
          <Link
            data-an-prefetch="render"
            to={localizedPath("/apps")}
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
          >
            {t("skillsPage.browseTemplates")}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
