import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconPhoto, IconPlus, IconUpload, IconX } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

import {
  submitCommunityApp,
  uploadCommunityScreenshot,
} from "../lib/community-form-client";
import { sitePathForLocale } from "./docs-locale";
import { Button } from "./website-redesign/ds/button";

export const COMMUNITY_FORM_NAME = "community-app-submission";
const SCREENSHOT_MAX_COUNT = 5;
const SCREENSHOT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SCREENSHOT_BYTES = 1.5 * 1024 * 1024;

type SelectedScreenshot = {
  file: File;
  previewUrl: string;
};

export type CommunitySubmissionDraft = {
  name: string;
  appUrl: string;
  description: string;
  repositoryUrl: string;
  screenshotFiles: File[];
};

type CommunitySubmissionValues = Omit<
  CommunitySubmissionDraft,
  "screenshotFiles"
>;
type CommunitySubmissionField = keyof CommunitySubmissionValues | "screenshots";
type CommunitySubmissionErrors = Partial<
  Record<CommunitySubmissionField, string>
>;

function createSelectedScreenshots(files: File[]) {
  return files.map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

export function normalizeHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isHttpUrl(value: string) {
  const normalized = normalizeHttpUrl(value);
  if (!URL.canParse(normalized)) return false;
  const url = new URL(normalized);
  return url.protocol === "http:" || url.protocol === "https:";
}

export function isGitHubRepositoryUrl(value: string) {
  if (!isHttpUrl(value)) return false;
  const url = new URL(normalizeHttpUrl(value));
  const hostname = url.hostname.toLowerCase();
  const pathSegments = url.pathname.split("/").filter(Boolean);
  return (
    (hostname === "github.com" || hostname === "www.github.com") &&
    pathSegments.length >= 2
  );
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

function InlineError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p
      id={id}
      role="alert"
      className="m-0 font-[family-name:var(--b-font-sans)] text-sm leading-[1.4] text-[var(--c-red-400)]"
    >
      {message}
    </p>
  );
}

type CommunityAppSubmissionFormProps = {
  draft?: CommunitySubmissionDraft;
  onDraftChange?: (draft: CommunitySubmissionDraft) => void;
};

export function CommunityAppSubmissionForm({
  draft,
  onDraftChange,
}: CommunityAppSubmissionFormProps = {}) {
  const t = useT();
  const { locale } = useLocale();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const pageLoadTimeRef = useRef(Date.now());
  const idempotencyKeyRef = useRef<string | undefined>(undefined);
  const [values, setValues] = useState<CommunitySubmissionValues>(() => ({
    name: draft?.name ?? "",
    appUrl: draft?.appUrl ?? "",
    description: draft?.description ?? "",
    repositoryUrl: draft?.repositoryUrl ?? "",
  }));
  const [screenshots, setScreenshots] = useState<SelectedScreenshot[]>(() =>
    createSelectedScreenshots(draft?.screenshotFiles ?? []),
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [errors, setErrors] = useState<CommunitySubmissionErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const activePreviewUrls = new Set(
      screenshots.map((screenshot) => screenshot.previewUrl),
    );

    for (const previewUrl of previewUrlsRef.current) {
      if (!activePreviewUrls.has(previewUrl)) URL.revokeObjectURL(previewUrl);
    }
    previewUrlsRef.current = activePreviewUrls;
  }, [screenshots]);

  useEffect(() => {
    onDraftChange?.({
      ...values,
      screenshotFiles: screenshots.map((screenshot) => screenshot.file),
    });
  }, [onDraftChange, screenshots, values]);

  useEffect(() => {
    return () => {
      for (const previewUrl of previewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  function updateValue(field: keyof CommunitySubmissionValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError(undefined);
  }

  function setFieldError(field: CommunitySubmissionField, message?: string) {
    setErrors((current) => {
      if (!message && !current[field]) return current;
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function normalizeUrlField(field: "appUrl" | "repositoryUrl") {
    const normalized = normalizeHttpUrl(values[field]);
    if (normalized !== values[field]) updateValue(field, normalized);
    validateField(field, { ...values, [field]: normalized });
  }

  function validateField(
    field: CommunitySubmissionField,
    currentValues = values,
    currentScreenshots = screenshots,
  ) {
    let message: string | undefined;

    if (field === "name" && !currentValues.name.trim()) {
      message = t("templatesPage.communitySubmissionNameError");
    } else if (field === "description" && !currentValues.description.trim()) {
      message = t("templatesPage.communitySubmissionDescriptionError");
    } else if (field === "appUrl" && !isHttpUrl(currentValues.appUrl)) {
      message = t("templatesPage.communitySubmissionUrlError");
    } else if (
      field === "repositoryUrl" &&
      currentValues.repositoryUrl.trim() &&
      !isGitHubRepositoryUrl(currentValues.repositoryUrl)
    ) {
      message = t("templatesPage.communitySubmissionRepositoryError");
    } else if (
      field === "screenshots" &&
      currentScreenshots.some(({ file }) => !isValidScreenshot(file))
    ) {
      message = t("templatesPage.communitySubmissionScreenshotsError");
    }

    setFieldError(field, message);
    return message;
  }

  function validateSubmission(
    currentValues: CommunitySubmissionValues,
    currentScreenshots: SelectedScreenshot[],
  ) {
    const nextErrors: CommunitySubmissionErrors = {};
    const fields: CommunitySubmissionField[] = [
      "name",
      "description",
      "appUrl",
      "repositoryUrl",
      "screenshots",
    ];

    for (const field of fields) {
      const message = validateField(field, currentValues, currentScreenshots);
      if (message) nextErrors[field] = message;
    }

    return nextErrors;
  }

  function handleScreenshotChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files) addScreenshots(files);
    event.currentTarget.value = "";
  }

  function addScreenshots(files: FileList | File[]) {
    const incomingFiles = Array.from(files);
    const validFiles = incomingFiles.filter(isValidScreenshot);
    const availableSlots = SCREENSHOT_MAX_COUNT - screenshots.length;
    const filesToAdd = validFiles.slice(0, Math.max(availableSlots, 0));

    if (filesToAdd.length > 0) {
      setScreenshots((current) => [
        ...current,
        ...filesToAdd.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
      setSubmitError(undefined);
    }

    if (
      validFiles.length > availableSlots ||
      validFiles.length !== incomingFiles.length
    ) {
      setFieldError(
        "screenshots",
        t("templatesPage.communitySubmissionScreenshotsError"),
      );
    } else if (filesToAdd.length > 0) {
      setFieldError("screenshots");
    }
  }

  function removeScreenshot(index: number) {
    setScreenshots((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setFieldError("screenshots");
    setSubmitError(undefined);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    addScreenshots(event.dataTransfer.files);
  }

  function focusFirstError(
    form: HTMLFormElement,
    nextErrors: CommunitySubmissionErrors,
  ) {
    const field = Object.keys(nextErrors)[0] as
      | CommunitySubmissionField
      | undefined;
    if (!field) return;

    const element =
      field === "screenshots"
        ? fileInputRef.current
        : form.elements.namedItem(
            field === "appUrl"
              ? "app_url"
              : field === "repositoryUrl"
                ? "repository_url"
                : field,
          );
    if (element instanceof HTMLElement) element.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const submissionValues = {
      ...values,
      name: values.name.trim(),
      appUrl: normalizeHttpUrl(values.appUrl),
      description: values.description.trim(),
      repositoryUrl: values.repositoryUrl.trim()
        ? normalizeHttpUrl(values.repositoryUrl)
        : "",
    };
    setValues(submissionValues);
    const nextErrors = validateSubmission(submissionValues, screenshots);
    setErrors(nextErrors);
    setSubmitError(undefined);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(event.currentTarget, nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const uploadedScreenshots = await Promise.all(
        screenshots.map(({ file }) => uploadCommunityScreenshot(file)),
      );
      await submitCommunityApp({
        data: {
          name: submissionValues.name,
          app_url: submissionValues.appUrl,
          description: submissionValues.description,
          ...(submissionValues.repositoryUrl
            ? { repository_url: submissionValues.repositoryUrl }
            : {}),
          screenshots: uploadedScreenshots,
        },
        pageUrl: window.location.href,
        idempotencyKey: (idempotencyKeyRef.current ??= crypto.randomUUID()),
        pageLoadTime: pageLoadTimeRef.current,
      });
      trackEvent("submit community app", {
        location: "community_submission_form",
        hasRepository: Boolean(submissionValues.repositoryUrl),
        screenshotCount: uploadedScreenshots.length,
      });
      window.location.assign(
        `${sitePathForLocale("/apps", locale)}?community-submission=received`,
      );
    } catch {
      setSubmitError(t("templatesPage.communitySubmissionSubmitError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function inputClassName(field: CommunitySubmissionField) {
    return `${fieldClassName}${errors[field] ? " border-[var(--c-red-400)] focus:border-[var(--c-red-400)] focus:ring-[var(--c-red-400)]" : ""}`;
  }

  function errorId(field: CommunitySubmissionField) {
    return `${formId}-${field}-error`;
  }

  return (
    <form
      name={COMMUNITY_FORM_NAME}
      className="grid gap-5"
      onSubmit={handleSubmit}
      noValidate
      aria-describedby={submitError ? `${formId}-submit-error` : undefined}
    >
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
          aria-required="true"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? errorId("name") : undefined}
          value={values.name}
          onChange={(event) => updateValue("name", event.target.value)}
          onBlur={() => validateField("name")}
          placeholder={t("templatesPage.communitySubmissionNamePlaceholder")}
          className={inputClassName("name")}
        />
        <InlineError id={errorId("name")} message={errors.name} />
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
          aria-required="true"
          aria-invalid={Boolean(errors.appUrl)}
          aria-describedby={errors.appUrl ? errorId("appUrl") : undefined}
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={values.appUrl}
          onChange={(event) => updateValue("appUrl", event.target.value)}
          onBlur={() => normalizeUrlField("appUrl")}
          placeholder={t("templatesPage.communitySubmissionUrlPlaceholder")}
          className={inputClassName("appUrl")}
        />
        <InlineError id={errorId("appUrl")} message={errors.appUrl} />
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
          aria-required="true"
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description ? errorId("description") : undefined
          }
          rows={4}
          value={values.description}
          onChange={(event) => updateValue("description", event.target.value)}
          onBlur={() => validateField("description")}
          placeholder={t(
            "templatesPage.communitySubmissionDescriptionPlaceholder",
          )}
          className={inputClassName("description")}
        />
        <InlineError id={errorId("description")} message={errors.description} />
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
          aria-invalid={Boolean(errors.repositoryUrl)}
          aria-describedby={
            errors.repositoryUrl ? errorId("repositoryUrl") : undefined
          }
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={values.repositoryUrl}
          onChange={(event) => updateValue("repositoryUrl", event.target.value)}
          onBlur={() => normalizeUrlField("repositoryUrl")}
          placeholder={t(
            "templatesPage.communitySubmissionRepositoryPlaceholder",
          )}
          className={inputClassName("repositoryUrl")}
        />
        <InlineError
          id={errorId("repositoryUrl")}
          message={errors.repositoryUrl}
        />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-4">
          <p
            id={`${formId}-screenshots-label`}
            className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-primary)]"
          >
            {t("templatesPage.communitySubmissionScreenshots")}
          </p>
          <span
            className="font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-2)] font-semibold uppercase tracking-[0.04em] text-[var(--b-text-muted)]"
            aria-live="polite"
          >
            {t("templatesPage.communitySubmissionScreenshotsCount", {
              count: screenshots.length,
            })}
          </span>
        </div>

        <div
          data-community-screenshot-dropzone="true"
          role="group"
          aria-labelledby={`${formId}-screenshots-label`}
          aria-invalid={Boolean(errors.screenshots)}
          aria-describedby={`${formId}-screenshots-help${errors.screenshots ? ` ${errorId("screenshots")}` : ""}`}
          className={`rounded-[var(--b-radius)] border border-dashed p-4 transition-[background,border-color] duration-150 sm:p-5 ${
            isDragActive
              ? "border-[var(--b-text-primary)] bg-[var(--b-action-secondary-hover)]"
              : errors.screenshots
                ? "border-[var(--c-red-400)] bg-[var(--b-bg-inset)]"
                : "border-[var(--b-border-default)] bg-[var(--b-bg-inset)] hover:border-[var(--b-text-primary)]"
          }`}
          onDragOver={handleDragOver}
          onDragEnter={() => setIsDragActive(true)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            id={`${formId}-screenshots`}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleScreenshotChange}
            aria-label={t("templatesPage.communitySubmissionScreenshotsAdd")}
          />
          <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-page)] text-[var(--b-text-primary)]">
                <IconPhoto size={20} stroke={1.7} />
              </span>
              <div>
                <p className="m-0 font-[family-name:var(--b-font-sans)] text-sm font-medium leading-[1.35] text-[var(--b-text-primary)]">
                  {t("templatesPage.communitySubmissionScreenshotsPlaceholder")}
                </p>
                <p
                  id={`${formId}-screenshots-help`}
                  className="mt-1 mb-0 font-[family-name:var(--b-font-sans)] text-xs leading-[1.4] text-[var(--b-text-muted)]"
                >
                  {t("templatesPage.communitySubmissionScreenshotDropHint")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              icon={IconPlus}
              disabled={screenshots.length === SCREENSHOT_MAX_COUNT}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("templatesPage.communitySubmissionScreenshotsAdd")}
            </Button>
          </div>
        </div>

        <InlineError id={errorId("screenshots")} message={errors.screenshots} />

        {screenshots.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {screenshots.map((screenshot, index) => (
              <div
                key={`${screenshot.file.name}-${screenshot.file.lastModified}-${index}`}
                className="group relative min-w-0 overflow-hidden rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-inset)]"
              >
                <img
                  src={screenshot.previewUrl}
                  alt={t("templatesPage.communitySubmissionScreenshotSlot", {
                    index: index + 1,
                  })}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <Button
                  type="button"
                  variant="secondary-icon"
                  icon={IconX}
                  aria-label={t(
                    "templatesPage.communitySubmissionScreenshotRemove",
                    { index: index + 1 },
                  )}
                  title={t(
                    "templatesPage.communitySubmissionScreenshotRemove",
                    { index: index + 1 },
                  )}
                  className="absolute top-2 right-2 size-8 p-0"
                  onClick={() => removeScreenshot(index)}
                >
                  {null}
                </Button>
                <p className="m-0 truncate border-t border-solid border-[var(--b-border-default)] px-2.5 py-2 font-[family-name:var(--b-font-sans)] text-xs text-[var(--b-text-secondary)]">
                  {screenshot.file.name}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="cta"
          type="submit"
          icon={IconUpload}
          disabled={isSubmitting}
        >
          {isSubmitting
            ? t("templatesPage.communitySubmissionSubmitting")
            : t("templatesPage.communitySubmissionSubmit")}
        </Button>
        <InlineError id={`${formId}-submit-error`} message={submitError} />
      </div>
    </form>
  );
}
