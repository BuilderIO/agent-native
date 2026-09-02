import { useLocale, useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";
import { Link, useOutlet } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { ADDITIONAL_LEGAL_POLICY_METADATA } from "../legal-policy-list";
import { withDefaultSocialImage } from "../seo";

const UPDATED_AT = "September 2, 2026";

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Legal Resources - Agent-Native",
    },
    {
      name: "description",
      content:
        "Standalone Agent-Native hosted-service terms, privacy, acceptable-use, AI, safety, copyright, takedown, and law-enforcement policies.",
    },
    {
      property: "og:title",
      content: "Legal Resources - Agent-Native",
    },
    {
      property: "og:description",
      content:
        "Standalone Agent-Native hosted-service terms, privacy, acceptable-use, AI, safety, copyright, takedown, and law-enforcement policies.",
    },
  ]);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-24 border-t border-[var(--docs-border)] py-8">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight text-[var(--fg)]">
        {title}
      </h2>
      <div className="space-y-4 text-base leading-7 text-[var(--fg-secondary)]">
        {children}
      </div>
    </section>
  );
}

const linkClassName =
  "font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]";

export default function LegalPage() {
  const outlet = useOutlet();
  const t = useT();
  const { locale } = useLocale();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);
  const policyLabels = {
    acceptableUse: t("legal.resources.links.acceptableUse"),
    aiTerms: t("legal.resources.links.aiTerms"),
    platformRules: t("legal.resources.links.platformRules"),
    takedown: t("legal.resources.links.takedown"),
    lawEnforcement: t("legal.resources.links.lawEnforcement"),
  } as const;

  if (outlet) return outlet;

  return (
    <main className="mx-auto w-full max-w-site px-6 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-[980px]">
        <header className="mb-10">
          <p className="mb-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
            {t("legal.resources.eyebrow")}
          </p>
          <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
            {t("legal.resources.title")}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
            {t("legal.resources.intro")}
          </p>
          <p className="mt-4 text-sm text-[var(--fg-secondary)]">
            {t("legal.lastUpdated", { date: UPDATED_AT })}
          </p>
        </header>

        <Section title={t("legal.resources.agentNative.title")}>
          <p>{t("legal.resources.agentNative.body")}</p>
          <ul className="m-0 list-disc space-y-2 pl-5">
            <li>
              <Link to={localizedPath("/terms")} className={linkClassName}>
                {t("legal.resources.agentNative.terms")}
              </Link>
            </li>
            <li>
              <Link to={localizedPath("/privacy")} className={linkClassName}>
                {t("legal.resources.agentNative.privacy")}
              </Link>
            </li>
          </ul>
        </Section>

        <Section title={t("legal.resources.builder.title")}>
          <p>{t("legal.resources.builder.body")}</p>
          <ul className="m-0 list-disc space-y-2 pl-5">
            {ADDITIONAL_LEGAL_POLICY_METADATA.map((policy) => (
              <li key={policy.slug}>
                <Link
                  to={localizedPath("/legal/" + policy.slug)}
                  className={linkClassName}
                >
                  {policyLabels[policy.key as keyof typeof policyLabels]}
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("legal.resources.notIncluded.title")}>
          <p>{t("legal.resources.notIncluded.body")}</p>
        </Section>
      </div>
    </main>
  );
}
