import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconUpload } from "@tabler/icons-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import { sitePathForLocale } from "./docs-locale";
import { Button } from "./website-redesign/ds/button";

const COMMUNITY_FORM_NAME = "community-app-submission";
const SCREENSHOT_FIELDS = [
  "screenshot_1",
  "screenshot_2",
  "screenshot_3",
  "screenshot_4",
  "screenshot_5",
] as const;
const SCREENSHOT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SCREENSHOT_BYTES = 1.5 * 1024 * 1024;

type CommunitySubmissionValues = {
  name: string;
  appUrl: string;
  description: string;
  repositoryUrl: string;
};

function isHttpUrl(value: string) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" || url.protocol === "https:";
}

function isValidScreenshot(file: File) {
  return (
    SCREENSHOT_TYPES.has(file.type) &&
    file.size > 0 &&
    file.size <= MAX_SCREENSHOT_BYTES
  );
}

const fieldClassName =
  "w-full rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-inset)] px-3 py-2.5 font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--b-text-muted)] focus:border-[var(--b-action-primary-bg)] focus:ring-2 focus:ring-[var(--b-action-primary-effect)]";

const fileFieldClassName =
  "block w-full min-w-0 cursor-pointer rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-inset)] px-2 py-2 font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-secondary)] outline-none file:mr-3 file:cursor-pointer file:rounded-[var(--b-radius)] file:border file:border-solid file:border-[var(--b-action-secondary-border)] file:bg-[var(--b-action-secondary-bg)] file:px-3 file:py-2 file:font-[family-name:var(--b-font-mono)] file:text-[length:var(--b-t-label-2)] file:font-semibold file:uppercase file:tracking-[0.04em] file:text-[var(--b-action-secondary-text)] hover:file:bg-[var(--b-action-secondary-hover)] focus:border-[var(--b-action-primary-bg)] focus:ring-2 focus:ring-[var(--b-action-primary-effect)]";

export function CommunityAppSubmissionForm() {
  const t = useT();
  const { locale } = useLocale();
  const formId = useId();
  const [values, setValues] = useState<CommunitySubmissionValues>({
    name: "",
    appUrl: "",
    description: "",
    repositoryUrl: "",
  });
  const [screenshots, setScreenshots] = useState<Array<File | null>>(() =>
    SCREENSHOT_FIELDS.map(() => null),
  );
  const [error, setError] = useState<string | null>(null);

  function updateValue(field: keyof CommunitySubmissionValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function handleScreenshotChange(
    index: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0] ?? null;
    if (file && !isValidScreenshot(file)) {
      event.currentTarget.value = "";
      setScreenshots((current) =>
        current.map((existing, currentIndex) =>
          currentIndex === index ? null : existing,
        ),
      );
      setError(t("templatesPage.communitySubmissionValidation"));
      return;
    }

    setScreenshots((current) =>
      current.map((existing, currentIndex) =>
        currentIndex === index ? file : existing,
      ),
    );
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const appUrl = String(formData.get("app_url") ?? "").trim();
    const repositoryUrl = String(formData.get("repository_url") ?? "").trim();
    const uploadedFiles = SCREENSHOT_FIELDS.map((field) =>
      formData.get(field),
    ).filter((value): value is File => value instanceof File && value.size > 0);

    if (
      !String(formData.get("name") ?? "").trim() ||
      !String(formData.get("description") ?? "").trim() ||
      !isHttpUrl(appUrl) ||
      (repositoryUrl && !isHttpUrl(repositoryUrl)) ||
      uploadedFiles.some((file) => !isValidScreenshot(file))
    ) {
      event.preventDefault();
      setError(t("templatesPage.communitySubmissionValidation"));
      return;
    }

    trackEvent("submit community app", {
      location: "community_submission_form",
      hasRepository: Boolean(repositoryUrl),
      screenshotCount: uploadedFiles.length,
    });
  }

  return (
    <form
      name={COMMUNITY_FORM_NAME}
      method="post"
      action={`${sitePathForLocale("/apps", locale)}?community-submission=received`}
      encType="multipart/form-data"
      data-netlify="true"
      data-netlify-honeypot="bot-field"
      className="grid gap-5"
      onSubmit={handleSubmit}
      aria-describedby={error ? `${formId}-error` : undefined}
    >
      <input type="hidden" name="form-name" value={COMMUNITY_FORM_NAME} />
      <div className="sr-only" aria-hidden="true">
        <input name="bot-field" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-name`}
          className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]"
        >
          {t("templatesPage.communitySubmissionName")}
        </label>
        <input
          id={`${formId}-name`}
          name="name"
          required
          value={values.name}
          onChange={(event) => updateValue("name", event.target.value)}
          placeholder={t("templatesPage.communitySubmissionNamePlaceholder")}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-url`}
          className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]"
        >
          {t("templatesPage.communitySubmissionUrl")}
        </label>
        <input
          id={`${formId}-url`}
          name="app_url"
          required
          type="url"
          value={values.appUrl}
          onChange={(event) => updateValue("appUrl", event.target.value)}
          placeholder={t("templatesPage.communitySubmissionUrlPlaceholder")}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-description`}
          className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]"
        >
          {t("templatesPage.communitySubmissionDescriptionLabel")}
        </label>
        <textarea
          id={`${formId}-description`}
          name="description"
          required
          rows={4}
          value={values.description}
          onChange={(event) => updateValue("description", event.target.value)}
          placeholder={t(
            "templatesPage.communitySubmissionDescriptionPlaceholder",
          )}
          className={fieldClassName}
        />
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-repository`}
          className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]"
        >
          {t("templatesPage.communitySubmissionRepository")}
        </label>
        <input
          id={`${formId}-repository`}
          name="repository_url"
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
        <div>
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]">
            {t("templatesPage.communitySubmissionScreenshots")}
          </p>
          <p className="mt-1.5 mb-0 font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--b-text-muted)]">
            {t("templatesPage.communitySubmissionScreenshotsPlaceholder")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCREENSHOT_FIELDS.map((field, index) => {
            const file = screenshots[index];
            const inputId = `${formId}-${field}`;
            return (
              <div key={field} className="min-w-0">
                <label
                  htmlFor={inputId}
                  className="mb-1.5 block font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-secondary)]"
                >
                  {t("templatesPage.communitySubmissionScreenshotSlot", {
                    index: index + 1,
                  })}
                </label>
                <input
                  id={inputId}
                  name={field}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={fileFieldClassName}
                  onChange={(event) => handleScreenshotChange(index, event)}
                />
                {file ? (
                  <p className="mt-1.5 mb-0 truncate font-[family-name:var(--b-font-sans)] text-xs text-[var(--b-text-secondary)]">
                    {file.name}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error ? (
        <p
          id={`${formId}-error`}
          role="alert"
          className="m-0 font-[family-name:var(--b-font-sans)] text-sm text-[var(--c-red-400)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="cta" type="submit" icon={IconUpload}>
          {t("templatesPage.communitySubmissionSubmit")}
        </Button>
      </div>
    </form>
  );
}
