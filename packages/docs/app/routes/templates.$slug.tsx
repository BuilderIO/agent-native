import { useState } from "react";
import {
  Link,
  redirect,
  useParams,
  type LoaderFunctionArgs,
} from "react-router";
import {
  IconArrowLeft,
  IconBrandGithub,
  IconCopy,
  IconExternalLink,
  IconTerminal2,
} from "@tabler/icons-react";
import {
  templates,
  trackEvent,
  type Template,
} from "../components/TemplateCard";
import { TemplateDocsLink } from "../components/template-docs";
import { withDefaultSocialImage, withTemplateSocialImage } from "../seo";

function findTemplate(slug: string | undefined) {
  if (slug === "videos") slug = "video";
  return templates.find((t) => t.slug === slug);
}

export function loader({ params }: LoaderFunctionArgs) {
  if (params.slug === "videos") {
    throw redirect("/templates/video", 301);
  }
  if (!findTemplate(params.slug)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export const meta = ({ params }: { params: { slug?: string } }) => {
  const template = findTemplate(params.slug);
  if (!template) {
    return withDefaultSocialImage([
      { title: "Template Not Found — Agent-Native" },
    ]);
  }
  return withTemplateSocialImage(
    [
      { title: `Agent-Native ${template.name} Template` },
      { name: "description", content: template.description },
    ],
    template.name,
  );
};

function TemplateFallbackArt({ template }: { template: Template }) {
  if (template.screenshot) {
    return (
      <img
        src={template.screenshot}
        alt={`${template.name} template screenshot`}
        className="h-full w-full object-cover object-top"
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-[320px] items-center justify-center"
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
      onClick={handleCopy}
      data-template-cli-copy
      className="flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:w-auto sm:max-w-[min(100%,36rem)] sm:px-5"
    >
      <IconTerminal2
        size={16}
        className="shrink-0 text-[var(--fg-secondary)]"
      />
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      <IconCopy
        size={16}
        className="ml-auto shrink-0 text-[var(--fg-secondary)]"
      />
      <span className="sr-only">{copied ? "Copied" : "Copy command"}</span>
    </button>
  );
}

export default function GenericTemplatePage() {
  const { slug } = useParams();
  const template = findTemplate(slug);

  if (!template) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-20">
        <Link
          data-an-prefetch="render"
          to="/templates"
          className="inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          <IconArrowLeft size={16} />
          All Templates
        </Link>
        <h1 className="mt-8 text-4xl font-bold tracking-tight">
          Template not found
        </h1>
        <p className="mt-3 text-[var(--fg-secondary)]">
          Browse the template catalog to find an available app.
        </p>
      </main>
    );
  }

  const hasDemoUrl = "demoUrl" in template && template.demoUrl;
  const sourceSlug = template.slug === "video" ? "videos" : template.slug;

  return (
    <main className="template-detail-page mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      <section className="py-12 sm:py-16 lg:py-20">
        <Link
          data-an-prefetch="render"
          to="/templates"
          className="inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
        >
          <IconArrowLeft size={16} />
          All Templates
        </Link>

        <div className="mt-8 grid min-w-0 gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              Agent-Native {template.name}
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              {template.name} template
            </h1>
            <p className="mb-3 text-sm font-medium text-[var(--docs-accent)]">
              {template.replaces}
            </p>
            <p className="mb-8 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {template.description}
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              {hasDemoUrl && (
                <a
                  href={template.demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                  onClick={() =>
                    trackEvent("try live demo", {
                      template: template.slug,
                      location: "generic_template_page",
                    })
                  }
                >
                  Try It
                  <IconExternalLink size={16} />
                </a>
              )}
              <TemplateDocsLink
                template={template}
                location="generic_template_page"
              />
              <a
                href={`https://github.com/BuilderIO/agent-native/tree/main/templates/${sourceSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
              >
                Source
                <IconBrandGithub size={16} />
              </a>
            </div>

            <CliCopy template={template} />
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <TemplateFallbackArt template={template} />
          </div>
        </div>
      </section>
    </main>
  );
}
