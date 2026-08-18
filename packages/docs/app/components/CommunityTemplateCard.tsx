import {
  IconBrandGithub,
  IconCheck,
  IconCopy,
  IconExternalLink,
} from "@tabler/icons-react";
import { useState } from "react";

import { trackEvent } from "./TemplateCard";

export interface CommunityTemplate {
  name: string;
  description: string;
  /** Public GitHub repository in owner/repo form. */
  repository: string;
  /** App id when the repository is an Agent Native workspace. */
  app?: string;
  /** Optional branch, tag, or commit to pin for installs. */
  ref?: string;
  /** Optional hosted version people can try before installing. */
  demoUrl?: string;
  /** Optional social or product screenshot shown above the card content. */
  screenshot?: string;
}

/**
 * Community listings stay separate from the first-party template allow-list.
 * Add reviewed submissions here after confirming the repository is public and
 * its linked demo represents the same source.
 */
export const communityTemplates: CommunityTemplate[] = [];

export const COMMUNITY_TEMPLATE_SUBMISSION_URL =
  "https://github.com/BuilderIO/agent-native/issues/new?template=community-template.yml";

export function communityTemplateCliCommand(
  template: CommunityTemplate,
): string {
  const app = template.app ? `?app=${template.app}` : "";
  const ref = template.ref ? `#${template.ref}` : "";
  const selection = `https://github.com/${template.repository}${app}${ref}`;
  return `npx @agent-native/core@latest create my-app --template ${
    app || ref ? `'${selection}'` : selection
  }`;
}

export function CommunityTemplateCard({
  template,
  labels,
}: {
  template: CommunityTemplate;
  labels: {
    copyInstallCommand: string;
    copied: string;
    repository: string;
    tryDemo: string;
  };
}) {
  const [copied, setCopied] = useState(false);
  const command = communityTemplateCliCommand(template);
  const repositoryUrl = `https://github.com/${template.repository}`;
  const sourceLabel = template.app
    ? `${template.repository} · apps/${template.app}`
    : template.repository;

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    trackEvent("copy community template command", {
      template: template.repository,
      location: "community_template_card",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <article className="feature-card flex min-w-0 flex-col gap-4 overflow-hidden">
      {template.screenshot ? (
        <a
          href={template.demoUrl ?? repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="-mx-[24px] -mt-[24px] block aspect-[924/729] overflow-hidden border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]"
        >
          <img
            src={template.screenshot}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-top transition-[opacity] hover:opacity-90"
          />
        </a>
      ) : null}

      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-[var(--fg)]">
            {template.name}
          </h3>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
            {sourceLabel}
          </p>
        </div>
        <IconBrandGithub
          className="size-5 shrink-0 text-[var(--fg-secondary)]"
          aria-hidden="true"
        />
      </div>

      <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {template.description}
      </p>

      <div className="mt-auto flex min-w-0 items-center gap-2 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]">
          {command}
        </code>
        <button
          type="button"
          onClick={copyCommand}
          className="shrink-0 rounded-md p-1.5 text-[var(--fg-secondary)] transition-[color,background-color] hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)]"
          aria-label={copied ? labels.copied : labels.copyInstallCommand}
        >
          {copied ? (
            <IconCheck className="size-4" aria-hidden="true" />
          ) : (
            <IconCopy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("click community template repository", {
              template: template.repository,
              location: "community_template_card",
            })
          }
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--docs-border)] px-4 py-2 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
        >
          <IconBrandGithub className="size-4" aria-hidden="true" />
          {labels.repository}
        </a>
        {template.demoUrl ? (
          <a
            href={template.demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent("click community template demo", {
                template: template.repository,
                location: "community_template_card",
              })
            }
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white no-underline transition-[background-color] hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <IconExternalLink className="size-4" aria-hidden="true" />
            {labels.tryDemo}
          </a>
        ) : null}
      </div>
    </article>
  );
}
