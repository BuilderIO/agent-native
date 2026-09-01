import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertCircle, IconArrowUpRight } from "@tabler/icons-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "./website-redesign/ds/button";

const COMMUNITY_ISSUE_URL =
  "https://github.com/BuilderIO/agent-native/issues/new";

export type CommunitySubmissionValues = {
  name: string;
  appUrl: string;
  // guard:allow-required-description - required user input for the submission payload, not page chrome
  description: string;
  repositoryUrl: string;
  screenshots: string;
};

function isHttpUrl(value: string) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" || url.protocol === "https:";
}

export function buildCommunitySubmissionUrl(values: CommunitySubmissionValues) {
  const screenshots = values.screenshots
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const body = [
    "### App name",
    values.name.trim(),
    "",
    "### App URL",
    values.appUrl.trim(),
    "",
    "### Description",
    values.description.trim(),
    "",
    "### GitHub repository",
    values.repositoryUrl.trim() || "Not provided",
    "",
    "### Screenshots",
    screenshots.length > 0
      ? screenshots.map((screenshot) => `- ${screenshot}`).join("\n")
      : "Not provided",
    "",
    "### Review notes",
    "Please review this listing before publishing it to the Agent-Native community marketplace.",
  ].join("\n");
  const url = new URL(COMMUNITY_ISSUE_URL);
  url.searchParams.set("title", `Community app: ${values.name.trim()}`);
  url.searchParams.set("body", body);
  return url.toString();
}

// The transparent rest border is load-bearing: it reserves the border box so
// the focus colour appears without a 1px layout shift. Focus deliberately
// returns the background to the rest colour, darker than hover, and Tailwind
// emits `hover` before `focus` so that ordering holds while typing.
const fieldClassName =
  "w-full rounded-[var(--b-radius)] border border-solid border-transparent bg-[var(--b-bg-prominent)] px-[15px] py-[9px] font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-normal tracking-[0.02em] text-[var(--b-action-secondary-text)] outline-none transition-[border-color,background] duration-150 placeholder:text-[var(--b-text-muted)] hover:bg-[var(--c-neutral-800)] focus:border-[var(--b-action-primary-bg)] focus:bg-[var(--b-bg-prominent)]";

const textareaClassName = `${fieldClassName} min-h-20 resize-y leading-[1.5]`;

// Sans label over a mono value, and a step larger than it: that pairing is the
// signature of the Builder form style.
const labelClassName =
  "font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] font-medium tracking-[0.01em] text-[var(--b-text-primary)]";

export function CommunityAppSubmissionForm() {
  const t = useT();
  const formId = useId();
  const [values, setValues] = useState<CommunitySubmissionValues>({
    name: "",
    appUrl: "",
    description: "",
    repositoryUrl: "",
    screenshots: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);

  function updateValue(field: keyof CommunitySubmissionValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
    setIssueUrl(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const appUrl = values.appUrl.trim();
    const repositoryUrl = values.repositoryUrl.trim();
    const screenshots = values.screenshots
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);

    if (
      !values.name.trim() ||
      !values.description.trim() ||
      !isHttpUrl(appUrl) ||
      (repositoryUrl && !isHttpUrl(repositoryUrl)) ||
      screenshots.some((screenshot) => !isHttpUrl(screenshot))
    ) {
      setError(t("templatesPage.communitySubmissionValidation"));
      return;
    }

    const nextIssueUrl = buildCommunitySubmissionUrl({
      ...values,
      appUrl,
      repositoryUrl,
    });
    setIssueUrl(nextIssueUrl);
    trackEvent("submit community app", {
      location: "community_submission_form",
      hasRepository: Boolean(repositoryUrl),
      screenshotCount: screenshots.length,
    });
    const issueWindow = window.open(
      nextIssueUrl,
      "_blank",
      "noopener,noreferrer",
    );
    if (issueWindow) issueWindow.opener = null;
  }

  return (
    <form
      className="grid gap-[var(--spacing-5)]"
      onSubmit={handleSubmit}
      aria-describedby={error ? `${formId}-error` : undefined}
    >
      <div className="grid gap-1.5">
        <label htmlFor={`${formId}-name`} className={labelClassName}>
          {t("templatesPage.communitySubmissionName")}
        </label>
        <input
          id={`${formId}-name`}
          required
          value={values.name}
          onChange={(event) => updateValue("name", event.target.value)}
          placeholder={t("templatesPage.communitySubmissionNamePlaceholder")}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${formId}-url`} className={labelClassName}>
          {t("templatesPage.communitySubmissionUrl")}
        </label>
        <input
          id={`${formId}-url`}
          required
          type="url"
          value={values.appUrl}
          onChange={(event) => updateValue("appUrl", event.target.value)}
          placeholder={t("templatesPage.communitySubmissionUrlPlaceholder")}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${formId}-description`} className={labelClassName}>
          {t("templatesPage.communitySubmissionDescriptionLabel")}
        </label>
        <textarea
          id={`${formId}-description`}
          required
          rows={4}
          value={values.description}
          onChange={(event) => updateValue("description", event.target.value)}
          placeholder={t(
            "templatesPage.communitySubmissionDescriptionPlaceholder",
          )}
          className={textareaClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${formId}-repository`} className={labelClassName}>
          {t("templatesPage.communitySubmissionRepository")}
        </label>
        <input
          id={`${formId}-repository`}
          type="url"
          value={values.repositoryUrl}
          onChange={(event) => updateValue("repositoryUrl", event.target.value)}
          placeholder={t(
            "templatesPage.communitySubmissionRepositoryPlaceholder",
          )}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={`${formId}-screenshots`} className={labelClassName}>
          {t("templatesPage.communitySubmissionScreenshots")}
        </label>
        <textarea
          id={`${formId}-screenshots`}
          rows={3}
          value={values.screenshots}
          onChange={(event) => updateValue("screenshots", event.target.value)}
          placeholder={t(
            "templatesPage.communitySubmissionScreenshotsPlaceholder",
          )}
          className={textareaClassName}
        />
      </div>

      {error ? (
        <p
          id={`${formId}-error`}
          role="alert"
          className="m-0 inline-flex items-center gap-[5px] self-start rounded-[var(--b-radius)] border border-solid border-[color-mix(in_srgb,var(--c-red-400)_28%,transparent)] bg-[color-mix(in_srgb,var(--c-red-400)_14%,transparent)] px-2.5 py-1 font-[family-name:var(--b-font-mono)] text-[11px] tracking-[0.02em] text-[var(--c-red-400)]"
        >
          <IconAlertCircle size={12} stroke={2} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="mt-[var(--spacing-2)] flex flex-col items-start gap-[var(--spacing-4)]">
        <Button variant="primary" type="submit" icon={IconArrowUpRight}>
          {t("templatesPage.communitySubmissionSubmit")}
        </Button>
        {issueUrl ? (
          <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templatesPage.communitySubmissionReady")}{" "}
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--b-text-link)] underline underline-offset-2"
            >
              {t("templatesPage.communitySubmissionOpenDraft")}
            </a>
          </p>
        ) : null}
      </div>
    </form>
  );
}
