import { useLocale, useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";

import { sitePathForLocale } from "../components/docs-locale";
import LegalPolicyPage from "../components/LegalPolicyPage";
import privacyMarkdown from "../legal-policies/privacy.md?raw";
import { withDefaultSocialImage } from "../seo";

const UPDATED_AT = "June 23, 2026";

const DATA_CATEGORY_KEYS = [
  "account",
  "hostedContent",
  "integrations",
  "usage",
] as const;

const USE_KEYS = ["provide", "transform", "auth", "support", "comply"] as const;

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Agent-Native Privacy Policy",
    },
    {
      name: "description",
      content:
        "Standalone privacy policy for Builder-operated Agent-Native hosted applications and related services.",
    },
  ]);

export default function PrivacyPage() {
  return <LegalPolicyPage markdown={privacyMarkdown} />;
}

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
      <h3 className="mb-2 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-[var(--fg)]">
        {title}
      </h3>
      <p className="m-0 text-sm leading-6 text-[var(--fg-secondary)]">{body}</p>
    </div>
  );
}

export function LocalizedPrivacyPage() {
  const t = useT();
  const { locale } = useLocale();
  const clipsAnchorUrl = `https://www.agent-native.com${sitePathForLocale(
    "/privacy",
    locale,
  )}#clips-chrome-extension`;

  return (
    <main className="mx-auto w-full max-w-site px-6 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-[980px]">
        <header className="mb-10">
          <p className="mb-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
            {t("legal.privacy.eyebrow")}
          </p>
          <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
            {t("legal.privacy.title")}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
            {t("legal.privacy.intro")}
          </p>
          <p className="mt-4 text-sm text-[var(--fg-secondary)]">
            {t("legal.lastUpdated", { date: UPDATED_AT })}
          </p>
        </header>

        <div className="mb-10 grid gap-4 md:grid-cols-3">
          <ScopeCard
            title={t("legal.privacy.scopeCards.hosted.title")}
            body={t("legal.privacy.scopeCards.hosted.body")}
          />
          <ScopeCard
            title={t("legal.privacy.scopeCards.openSource.title")}
            body={t("legal.privacy.scopeCards.openSource.body")}
          />
          <ScopeCard
            title={t("legal.privacy.scopeCards.selfHosted.title")}
            body={t("legal.privacy.scopeCards.selfHosted.body")}
          />
        </div>

        <Section title={t("legal.privacy.sections.scope")}>
          <p>{t("legal.privacy.paragraphs.scope1")}</p>
        </Section>

        <Section title={t("legal.privacy.sections.information")}>
          <div className="grid gap-4 md:grid-cols-2">
            {DATA_CATEGORY_KEYS.map((categoryKey) => (
              <article
                key={categoryKey}
                className="rounded-lg border border-[var(--docs-border)] p-5"
              >
                <h3 className="mb-2 text-base font-semibold text-[var(--fg)]">
                  {t(`legal.privacy.dataCategories.${categoryKey}.title`)}
                </h3>
                <p className="m-0 text-sm leading-6">
                  {t(`legal.privacy.dataCategories.${categoryKey}.body`)}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section
          id="clips-chrome-extension"
          title={t("legal.privacy.sections.clipsExtension")}
        >
          <p>{t("legal.privacy.paragraphs.clips1")}</p>
          <p>{t("legal.privacy.paragraphs.clips2")}</p>
          <p>
            {t("legal.privacy.paragraphs.clipsAnchor")}{" "}
            <code className="rounded border border-[var(--code-border)] bg-[var(--code-bg)] px-1.5 py-0.5 text-sm text-[var(--fg)]">
              {clipsAnchorUrl}
            </code>
            .
          </p>
        </Section>

        <Section title={t("legal.privacy.sections.use")}>
          <ul className="m-0 list-disc space-y-2 pl-5">
            {USE_KEYS.map((useKey) => (
              <li key={useKey}>{t(`legal.privacy.uses.${useKey}`)}</li>
            ))}
          </ul>
        </Section>

        <Section title={t("legal.privacy.sections.sharing")}>
          <p>{t("legal.privacy.paragraphs.sharing1")}</p>
          <p>{t("legal.privacy.paragraphs.sharing2")}</p>
        </Section>

        <Section title={t("legal.privacy.sections.chromeLimitedUse")}>
          <p>{t("legal.privacy.paragraphs.chromeLimitedUse")}</p>
        </Section>

        <Section title={t("legal.privacy.sections.retention")}>
          <p>{t("legal.privacy.paragraphs.retention1")}</p>
          <p>{t("legal.privacy.paragraphs.retention2")}</p>
        </Section>

        <Section title={t("legal.privacy.sections.security")}>
          <p>{t("legal.privacy.paragraphs.security")}</p>
        </Section>

        <Section title={t("legal.privacy.sections.changes")}>
          <p>{t("legal.privacy.paragraphs.changes1")}</p>
        </Section>
      </div>
    </main>
  );
}
