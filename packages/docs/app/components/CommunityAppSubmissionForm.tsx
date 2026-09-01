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

type SelectedScreenshot = {
  file: File;
  previewUrl: string;
};

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

export function CommunityAppSubmissionForm() {
  const t = useT();
  const { locale } = useLocale();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const [values, setValues] = useState<CommunitySubmissionValues>({
    name: "",
    appUrl: "",
    description: "",
    repositoryUrl: "",
  });
  const [screenshots, setScreenshots] = useState<SelectedScreenshot[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    return () => {
      for (const previewUrl of previewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    for (const index of SCREENSHOT_FIELDS.keys()) {
      const input = hiddenInputRefs.current[index];
      if (!input) continue;

      const dataTransfer = new DataTransfer();
      const screenshot = screenshots[index];
      if (screenshot) dataTransfer.items.add(screenshot.file);
      input.files = dataTransfer.files;
    }
  }, [screenshots]);

  function updateValue(field: keyof CommunitySubmissionValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function handleScreenshotChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files) addScreenshots(files);
    event.currentTarget.value = "";
  }

  function addScreenshots(files: FileList | File[]) {
    const incomingFiles = Array.from(files);
    const validFiles = incomingFiles.filter(isValidScreenshot);
    const availableSlots = SCREENSHOT_FIELDS.length - screenshots.length;
    const filesToAdd = validFiles.slice(0, availableSlots);

    if (filesToAdd.length > 0) {
      setScreenshots((current) => [
        ...current,
        ...filesToAdd.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
    }

    if (
      validFiles.length > availableSlots ||
      validFiles.length !== incomingFiles.length
    ) {
      setError(t("templatesPage.communitySubmissionValidation"));
    } else {
      setError(null);
    }
  }

  function removeScreenshot(index: number) {
    setScreenshots((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setError(null);
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
          className={`rounded-[var(--b-radius)] border border-dashed p-4 transition-[background,border-color] duration-150 sm:p-5 ${
            isDragActive
              ? "border-[var(--b-text-primary)] bg-[var(--b-action-secondary-hover)]"
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
            aria-describedby={`${formId}-screenshots-help`}
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
              disabled={screenshots.length === SCREENSHOT_FIELDS.length}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("templatesPage.communitySubmissionScreenshotsAdd")}
            </Button>
          </div>
        </div>

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

        <div className="hidden" aria-hidden="true">
          {SCREENSHOT_FIELDS.map((field, index) => (
            <input
              key={field}
              ref={(element) => {
                hiddenInputRefs.current[index] = element;
              }}
              name={field}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              tabIndex={-1}
            />
          ))}
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
