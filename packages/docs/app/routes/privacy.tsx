import { useT } from "@agent-native/core/client";
import type { ReactNode } from "react";

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
      title: "Privacy Policy - Agent-Native hosted applications",
    },
    {
      name: "description",
      content:
        "Privacy policy for Agent-Native hosted applications, apps, and browser extensions.",
    },
    {
      property: "og:title",
      content: "Privacy Policy - Agent-Native hosted applications",
    },
    {
      property: "og:description",
      content:
        "How Agent-Native hosted applications collect, use, share, and retain data.",
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

export default function PrivacyPage() {
  const t = useT();

  return (
    <main className="mx-auto w-full max-w-[980px] px-6 py-14 sm:py-20">
      <header className="mb-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
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
        <p>
          {t("legal.privacy.paragraphs.scope2Prefix")}{" "}
          <a
            href="https://www.builder.io/legal/privacy"
            className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
          >
            {t("legal.privacy.links.builderPrivacy")}
          </a>{" "}
          {t("legal.privacy.paragraphs.scope2Suffix")}
        </p>
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
            https://www.agent-native.com/privacy#clips-chrome-extension
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
        <p>
          {t("legal.privacy.paragraphs.changes2Prefix")}{" "}
          <a
            href="https://www.builder.io/legal/privacy"
            className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
          >
            {t("legal.privacy.links.builderPrivacyFull")}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
