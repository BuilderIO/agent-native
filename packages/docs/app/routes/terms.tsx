import { useLocale } from "@agent-native/core/client";
import { useT } from "@agent-native/core/client";
import type { ReactNode } from "react";

import { sitePathForLocale } from "../components/docs-locale";
import { withDefaultSocialImage } from "../seo";

const UPDATED_AT = "June 24, 2026";

const HOSTED_SERVICE_KEYS = [
  "create",
  "workflows",
  "store",
  "improve",
] as const;

const ACCEPTABLE_USE_KEYS = [
  "laws",
  "bypass",
  "malware",
  "spam",
  "sensitive",
] as const;

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Terms of Service - Agent-Native hosted applications",
    },
    {
      name: "description",
      content:
        "Terms of Service for Agent-Native hosted applications, apps, demos, and official hosted services.",
    },
    {
      property: "og:title",
      content: "Terms of Service - Agent-Native hosted applications",
    },
    {
      property: "og:description",
      content:
        "The terms that apply when Builder.io operates Agent-Native hosted applications and app services.",
    },
  ]);

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-[var(--docs-border)] py-8"
    >
      <h2 className="mb-4 text-2xl font-semibold tracking-tight text-[var(--fg)]">
        {title}
      </h2>
      <div className="space-y-4 text-base leading-7 text-[var(--fg-secondary)]">
        {children}
      </div>
    </section>
  );
}

function ScopeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--fg)]">
        {title}
      </h3>
      <p className="m-0 text-sm leading-6 text-[var(--fg-secondary)]">{body}</p>
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  const { locale } = useLocale();
  const localizedHref = href.startsWith("/")
    ? sitePathForLocale(href, locale)
    : href;

  return (
    <a
      href={localizedHref}
      className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
    >
      {children}
    </a>
  );
}

export default function TermsPage() {
  const t = useT();

  return (
    <main className="mx-auto w-full max-w-[980px] px-6 py-14 sm:py-20">
      <header className="mb-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
          {t("legal.terms.eyebrow")}
        </p>
        <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
          {t("legal.terms.title")}
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
          {t("legal.terms.intro")}
        </p>
        <p className="mt-4 text-sm text-[var(--fg-secondary)]">
          {t("legal.lastUpdated", { date: UPDATED_AT })}
        </p>
      </header>

      <div className="mb-10 grid gap-4 md:grid-cols-3">
        <ScopeCard
          title={t("legal.terms.scopeCards.hosted.title")}
          body={t("legal.terms.scopeCards.hosted.body")}
        />
        <ScopeCard
          title={t("legal.terms.scopeCards.openSource.title")}
          body={t("legal.terms.scopeCards.openSource.body")}
        />
        <ScopeCard
          title={t("legal.terms.scopeCards.selfHosted.title")}
          body={t("legal.terms.scopeCards.selfHosted.body")}
        />
      </div>

      <Section title={t("legal.terms.sections.scope")}>
        <p>{t("legal.terms.paragraphs.scope1")}</p>
        <p>
          {t("legal.terms.paragraphs.scope2Prefix")}{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            {t("legal.terms.links.builderTerms")}
          </InlineLink>{" "}
          {t("legal.terms.paragraphs.scope2Middle")}{" "}
          <InlineLink href="/privacy">
            {t("legal.terms.links.privacyPolicy")}
          </InlineLink>
          . {t("legal.terms.paragraphs.scope2Suffix")}
        </p>
      </Section>

      <Section title={t("legal.terms.sections.hostedService")}>
        <p>{t("legal.terms.paragraphs.hostedService")}</p>
        <ul className="m-0 list-disc space-y-2 pl-5">
          {HOSTED_SERVICE_KEYS.map((pointKey) => (
            <li key={pointKey}>
              {t(`legal.terms.hostedServicePoints.${pointKey}`)}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("legal.terms.sections.accounts")}>
        <p>{t("legal.terms.paragraphs.accounts1")}</p>
        <p>{t("legal.terms.paragraphs.accounts2")}</p>
      </Section>

      <Section title={t("legal.terms.sections.content")}>
        <p>{t("legal.terms.paragraphs.content1")}</p>
        <p>{t("legal.terms.paragraphs.content2")}</p>
      </Section>

      <Section title={t("legal.terms.sections.agents")}>
        <p>{t("legal.terms.paragraphs.agents1")}</p>
        <p>{t("legal.terms.paragraphs.agents2")}</p>
      </Section>

      <Section title={t("legal.terms.sections.acceptableUse")}>
        <ul className="m-0 list-disc space-y-2 pl-5">
          {ACCEPTABLE_USE_KEYS.map((pointKey) => (
            <li key={pointKey}>{t(`legal.terms.acceptableUse.${pointKey}`)}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("legal.terms.sections.openSource")}>
        <p>{t("legal.terms.paragraphs.openSource")}</p>
      </Section>

      <Section title={t("legal.terms.sections.suspension")}>
        <p>
          {t("legal.terms.paragraphs.suspensionPrefix")}{" "}
          <InlineLink href="/privacy">
            {t("legal.terms.links.privacyPolicy")}
          </InlineLink>
          .
        </p>
      </Section>

      <Section title={t("legal.terms.sections.disclaimers")}>
        <p>{t("legal.terms.paragraphs.disclaimers1")}</p>
        <p>
          {t("legal.terms.paragraphs.disclaimers2Prefix")}{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            {t("legal.terms.links.builderTerms")}
          </InlineLink>{" "}
          {t("legal.terms.paragraphs.disclaimers2Suffix")}
        </p>
      </Section>

      <Section title={t("legal.terms.sections.changes")}>
        <p>{t("legal.terms.paragraphs.changes1")}</p>
        <p>
          {t("legal.terms.paragraphs.changes2Prefix")}{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            {t("legal.terms.links.builderTerms")}
          </InlineLink>
          .
        </p>
      </Section>
    </main>
  );
}
