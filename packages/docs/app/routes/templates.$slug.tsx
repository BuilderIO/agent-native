import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconTerminal2,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useParams, type LoaderFunctionArgs } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { SectionDivider } from "../components/SectionDivider";
import { TemplateDocsLink } from "../components/template-docs";
import {
  TemplateActivationFrame,
  TemplateFinalCta,
  TemplateHero,
  TemplateLandingFaq,
  TemplateLandingShell,
} from "../components/template-landing";
import {
  templates,
  trackEvent,
  type Template,
} from "../components/TemplateCard";
import enUS from "../i18n/en-US";
import { withDefaultSocialImage, withTemplateSocialImage } from "../seo";

function findTemplate(slug: string | undefined) {
  return templates.find((t) => t.slug === slug);
}

export function loader({ params }: LoaderFunctionArgs) {
  if (!findTemplate(params.slug)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export const meta = ({ params }: { params: { slug?: string } }) => {
  const template = findTemplate(params.slug);
  if (!template) {
    return withDefaultSocialImage([
      { title: enUS.templateDetail.notFoundMetaTitle },
    ]);
  }
  const templateCopy =
    enUS.templates[template.slug as keyof typeof enUS.templates];
  return withTemplateSocialImage(
    [
      { title: `Agent-Native ${template.name} App` },
      {
        name: "description",
        content: templateCopy.description,
      },
    ],
    template.name,
  );
};

function TemplateFallbackArt({ template }: { template: Template }) {
  const t = useT();
  if (template.screenshot) {
    return (
      <img
        src={template.screenshot}
        alt={t("templateCard.screenshotAlt", { name: template.name })}
        loading="lazy"
        decoding="async"
        className="h-auto max-h-[640px] w-full object-cover object-top"
      />
    );
  }

  return (
    <div
      className="flex min-h-[320px] w-full items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${template.color}, ${template.color}22)`,
      }}
    >
      <span className="rounded-xl bg-[var(--bg)]/85 px-6 py-3 text-lg font-semibold text-[var(--fg)] shadow-sm">
        {template.name}
      </span>
    </div>
  );
}

function CliCopy({ template }: { template: Template }) {
  const [copied, setCopied] = useState(false);
  const t = useT();

  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "generic_template_page",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-template-cli-copy
      className="group flex w-full min-w-0 max-w-full items-center gap-3 rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition-[border-color] hover:border-[var(--fg-secondary)] sm:w-auto sm:max-w-[min(100%,36rem)] sm:px-5"
    >
      <IconTerminal2
        aria-hidden="true"
        size={16}
        className="shrink-0 text-[var(--fg-secondary)]"
      />
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      {copied ? (
        <IconCheck
          aria-hidden="true"
          size={16}
          className="ms-auto shrink-0 text-[var(--fg-secondary)]"
        />
      ) : (
        <IconCopy
          aria-hidden="true"
          size={16}
          className="ms-auto shrink-0 text-[var(--fg-secondary)]"
        />
      )}
      <span className="sr-only">
        {copied ? t("common.copied") : t("common.copyCommand")}
      </span>
    </button>
  );
}

export default function GenericTemplatePage() {
  const { slug } = useParams();
  const template = findTemplate(slug);
  const t = useT();
  const { locale } = useLocale();

  if (!template) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-20">
        <Link
          data-an-prefetch="viewport"
          to={sitePathForLocale("/apps", locale)}
          className="inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          <IconArrowLeft size={16} />
          {t("templateDetail.allTemplates")}
        </Link>
        <h1 className="mt-8 text-4xl font-bold tracking-tight">
          {t("templateDetail.notFoundTitle")}
        </h1>
        <p className="mt-3 text-[var(--fg-secondary)]">
          {t("templateDetail.notFoundBody")}
        </p>
      </main>
    );
  }

  const hasDemoUrl = "demoUrl" in template && template.demoUrl;
  const sourceSlug = template.slug;
  const replaces = t(`templates.${template.slug}.replaces`);
  const description = t(`templates.${template.slug}.description`);
  const faqItems = [
    {
      id: `${template.slug}-question-1`,
      question: t("templateLanding.faq.question1"),
      answer: <p className="m-0">{t("templateLanding.faq.answer1")}</p>,
    },
    {
      id: `${template.slug}-question-2`,
      question: t("templateLanding.faq.question2"),
      answer: <p className="m-0">{t("templateLanding.faq.answer2")}</p>,
    },
    {
      id: `${template.slug}-question-3`,
      question: t("templateLanding.faq.question3"),
      answer: <p className="m-0">{t("templateLanding.faq.answer3")}</p>,
    },
  ];

  return (
    <TemplateLandingShell>
      <TemplateHero
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateDetail.badge", { name: template.name })}
          </span>
        }
        title={t("templateDetail.title", { name: template.name })}
        description={<p className="m-0">{description}</p>}
        mediaClassName="bg-[var(--bg-secondary)]"
        media={<TemplateFallbackArt template={template} />}
      />

      <TemplateActivationFrame
        heading={
          <h2 className="m-0 text-2xl font-medium leading-tight tracking-tight text-[var(--fg)]">
            {replaces}
          </h2>
        }
      >
        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="template-detail-actions flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {hasDemoUrl ? (
              <a
                href={template.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] no-underline transition-[opacity] hover:opacity-90 hover:no-underline"
                onClick={(event) => {
                  applyFirstTouchAttributionToLink(event.currentTarget);
                  trackEvent("try live demo", {
                    template: template.slug,
                    location: "generic_template_page",
                  });
                }}
              >
                {t("common.tryIt")}
                <IconExternalLink aria-hidden="true" size={16} />
              </a>
            ) : null}
            <TemplateDocsLink
              template={template}
              location="generic_template_page"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
            />
            <a
              href={`https://github.com/BuilderIO/agent-native/tree/main/templates/${sourceSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
            >
              {t("common.source")}
              <IconBrandGithub aria-hidden="true" size={16} />
            </a>
          </div>
          <CliCopy template={template} />
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateFinalCta
        title={t("templateDetail.allTemplates")}
        actions={
          <Link
            data-an-prefetch="viewport"
            to={sitePathForLocale("/apps", locale)}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateDetail.allTemplates")}
          </Link>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <TemplateLandingFaq
        idPrefix={`${template.slug}-faq`}
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateLanding.faq.eyebrow")}
          </span>
        }
        title={t("templateLanding.faq.title")}
        items={faqItems}
      />
    </TemplateLandingShell>
  );
}
