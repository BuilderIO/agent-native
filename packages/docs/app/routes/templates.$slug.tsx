import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconArrowLeft, IconBrandGithub } from "@tabler/icons-react";
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
import { templates, type Template } from "../components/TemplateCard";
import enUS from "../i18n/en-US";
import { withDefaultSocialImage, withTemplateSocialImage } from "../seo";

const genericFaqCounts: Partial<Record<Template["slug"], number>> = {
  assets: 4,
  brain: 4,
  chat: 3,
};

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
  const faqCount = genericFaqCounts[template.slug];
  const faqItems = Array.from({ length: faqCount ?? 0 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `${template.slug}-question-${itemNumber}`,
      question: t(`templateLanding.${template.slug}.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.${template.slug}.faq.answer${itemNumber}`)}
        </p>
      ),
    };
  });

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
          <div className="template-detail-actions flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-[120px]">
            {hasDemoUrl ? (
              <a
                href={template.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button"
                onClick={(event) => {
                  applyFirstTouchAttributionToLink(event.currentTarget);
                  trackEvent("try live demo", {
                    template: template.slug,
                    location: "generic_template_page",
                  });
                }}
              >
                {t("common.tryIt")}
              </a>
            ) : null}
            <a
              href={`${template.demoUrl}/_agent-native/sign-in`}
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-button"
            >
              {t("common.signIn")}
            </a>
            <a
              href={`https://github.com/BuilderIO/agent-native/tree/main/templates/${sourceSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-button"
            >
              {t("common.source")}
              <IconBrandGithub aria-hidden="true" size={16} />
            </a>
          </div>
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      {!["assets", "chat"].includes(template.slug) ? (
        <TemplateFinalCta
          title={t("templateDetail.allTemplates")}
          actions={
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className="secondary-button"
            >
              {t("templateDetail.allTemplates")}
            </Link>
          }
        />
      ) : null}

      {faqItems.length > 0 ? (
        <>
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
        </>
      ) : null}
    </TemplateLandingShell>
  );
}
