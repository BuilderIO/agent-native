import {
  IconArrowLeft,
  IconBrandFigma,
  IconCheck,
  IconFileDescription,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useId, useRef, type ReactNode } from "react";

import { IconButton } from "../design-system/components.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "../ui/field.js";
import { Input } from "../ui/input.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Spinner } from "../ui/spinner.js";
import {
  DESIGN_SYSTEM_BRAND_FILE_ACCEPT,
  type DesignSystemCreationOptions,
  type DesignSystemSourceKind,
} from "./types.js";
import {
  sourceCardKind,
  useDesignSystemCreation,
  type DesignSystemCreationController,
} from "./use-design-system-creation.js";

const defaultComponents = {
  Badge,
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Spinner,
};
export type DesignSystemCreationComponents = typeof defaultComponents;

export interface DesignSystemCreationViewProps {
  controller: DesignSystemCreationController;
  components?: Partial<DesignSystemCreationComponents>;
  showBack?: boolean;
}

function ChoicePreview({
  kind,
  compact = false,
}: {
  kind: "fresh" | "references" | DesignSystemSourceKind;
  compact?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={
        compact
          ? "flex h-12 w-full items-center justify-center overflow-hidden rounded-md bg-muted/60 p-1.5"
          : "flex h-16 w-full items-center justify-center overflow-hidden rounded-md bg-muted/60 p-3"
      }
    >
      {kind === "references" || kind === "files" ? (
        <span className="grid h-full w-full max-w-32 grid-cols-3 items-center gap-2">
          <span className="flex h-9 flex-col justify-center gap-1 rounded border border-border bg-background p-1.5">
            <span className="h-1 w-full rounded bg-foreground/25" />
            <span className="h-1 w-2/3 rounded bg-foreground/15" />
            <span className="h-1 w-full rounded bg-foreground/15" />
          </span>
          <span className="flex h-10 items-center justify-center rounded border border-border bg-background p-1">
            <span className="size-4 rounded-full bg-primary/25" />
          </span>
          <span className="flex h-8 items-end rounded border border-border bg-background p-1">
            <span className="h-3 w-full rounded-sm bg-primary/20" />
          </span>
        </span>
      ) : kind === "figma" ? (
        <span className="grid h-full w-20 grid-cols-2 gap-1.5">
          <span className="rounded border border-border bg-background" />
          <span className="rounded-full bg-primary/25" />
          <span className="rounded bg-primary/15" />
          <span className="rounded border border-border bg-background" />
        </span>
      ) : (
        <span className="flex h-full w-full max-w-36 flex-col gap-1.5 rounded border border-border bg-background p-2">
          <span className="h-1 w-1/3 rounded bg-foreground/25" />
          <span className="grid min-h-0 flex-1 grid-cols-3 gap-1.5">
            <span className="col-span-2 rounded-sm bg-primary/20" />
            <span className="rounded-sm bg-muted" />
          </span>
        </span>
      )}
    </span>
  );
}

export function DesignSystemCreationView({
  controller,
  components,
  showBack = true,
}: DesignSystemCreationViewProps) {
  const {
    Badge,
    Button,
    Field,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldLabel,
    FieldLegend,
    FieldSet,
    FieldTitle,
    Input,
    RadioGroup,
    RadioGroupItem,
    Spinner,
  } = { ...defaultComponents, ...components };
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const {
    draft,
    labels,
    step,
    addingToSystemId,
    submitting,
    completed,
    error,
    sourceErrors,
  } = controller;
  const disabled = submitting || completed;
  const cards: Array<{
    kind: DesignSystemSourceKind;
    label: string;
    icon: typeof IconWorld;
  }> = [
    { kind: "website", label: labels.website, icon: IconWorld },
    { kind: "files", label: labels.files, icon: IconFileDescription },
    { kind: "figma", label: labels.figma, icon: IconBrandFigma },
  ];
  const canSubmit =
    step === "start"
      ? Boolean(draft.name.trim())
      : draft.sources.length > 0 && draft.uploads.length === 0;

  return (
    <form
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void controller.submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <div
        data-creation-body
        className="flex min-h-0 flex-col gap-5 overflow-y-auto p-1"
      >
        {step === "start" ? (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>{labels.name}</FieldLabel>
              <Input
                id={`${id}-name`}
                required
                maxLength={200}
                autoFocus
                value={draft.name}
                disabled={disabled}
                onChange={(event) => controller.setName(event.target.value)}
                aria-invalid={Boolean(error && !draft.name.trim())}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </Field>
            <FieldSet disabled={disabled}>
              <FieldLegend variant="label">{labels.startFrom}</FieldLegend>
              <RadioGroup
                value={draft.intent}
                onValueChange={(value) =>
                  controller.setIntent(value as "fresh" | "references")
                }
              >
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        value: "fresh",
                        title: labels.fresh,
                        description: labels.freshDescription,
                      },
                      {
                        value: "references",
                        title: labels.references,
                        description: labels.referencesDescription,
                      },
                    ] as const
                  ).map(({ value, title, description }) => (
                    <FieldLabel
                      key={value}
                      htmlFor={`${id}-${value}`}
                      className="min-w-0 cursor-pointer"
                    >
                      <Field>
                        <ChoicePreview kind={value} />
                        <div className="flex min-w-0 items-start gap-2">
                          <RadioGroupItem
                            id={`${id}-${value}`}
                            value={value}
                            aria-labelledby={`${id}-${value}-title`}
                            aria-describedby={
                              description
                                ? `${id}-${value}-description`
                                : undefined
                            }
                          />
                          <FieldTitle id={`${id}-${value}-title`}>
                            {title}
                          </FieldTitle>
                        </div>
                        <FieldContent>
                          {description && (
                            <FieldDescription id={`${id}-${value}-description`}>
                              {description}
                            </FieldDescription>
                          )}
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </div>
              </RadioGroup>
            </FieldSet>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {cards.map(({ kind, label }) => {
                const added = draft.sources.some(
                  (source) => sourceCardKind(source) === kind,
                );
                return (
                  <FieldLabel
                    asChild
                    key={kind}
                    className="min-w-0 cursor-pointer text-start data-[expanded=true]:border-primary data-[expanded=true]:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  >
                    <button
                      type="button"
                      autoFocus={kind === "website"}
                      disabled={disabled}
                      onClick={() => controller.toggleSource(kind)}
                      data-source={kind}
                      title={label}
                      data-state={added ? "added" : "empty"}
                      data-expanded={draft.openSources.includes(kind)}
                      aria-label={label}
                      aria-expanded={draft.openSources.includes(kind)}
                      aria-controls={`${id}-${kind}-editor`}
                      aria-describedby={
                        added ? `${id}-${kind}-added` : undefined
                      }
                    >
                      <Field>
                        <span className="relative block">
                          <ChoicePreview kind={kind} compact />
                          {added && (
                            <IconCheck
                              className="absolute end-1 top-1 size-4"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <span className="min-w-0 break-words">{label}</span>
                        {added && (
                          <>
                            <span
                              className="sr-only"
                              id={`${id}-${kind}-added`}
                            >
                              {labels.added}
                            </span>
                          </>
                        )}
                      </Field>
                    </button>
                  </FieldLabel>
                );
              })}
            </div>
            {draft.sources.length > 0 && (
              <div
                className="flex min-w-0 flex-wrap gap-2"
                aria-label={labels.added}
              >
                {draft.sources.map((source) => {
                  const name =
                    source.kind === "file" ? source.name : source.url;
                  const Icon = cards.find(
                    ({ kind }) => sourceCardKind(source) === kind,
                  )!.icon;
                  return (
                    <Badge
                      key={source.id}
                      variant="outline"
                      className="min-w-0 max-w-full gap-1"
                      title={name}
                    >
                      <Icon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 max-w-48 truncate">{name}</span>
                      <IconButton
                        size="compact"
                        emphasis="ghost"
                        label={labels.remove(name)}
                        icon={<IconX />}
                        disabled={disabled}
                        onPress={() => controller.remove(source.id)}
                      />
                    </Badge>
                  );
                })}
              </div>
            )}
            {cards
              .filter(({ kind }) => draft.openSources.includes(kind))
              .map(({ kind, label }) => (
                <section
                  key={kind}
                  id={`${id}-${kind}-editor`}
                  aria-label={label}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"
                >
                  {kind !== "files" && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-${kind}-url`}>
                        {kind === "website"
                          ? labels.websiteUrl
                          : labels.figmaUrl}
                      </FieldLabel>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <Input
                            id={`${id}-${kind}-url`}
                            type="url"
                            value={
                              kind === "website"
                                ? draft.websiteInput
                                : draft.figmaInput
                            }
                            disabled={disabled}
                            onChange={(event) =>
                              controller.setUrl(kind, event.target.value)
                            }
                            aria-invalid={Boolean(sourceErrors[kind])}
                            aria-describedby={
                              sourceErrors[kind]
                                ? `${id}-${kind}-error`
                                : undefined
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                controller.addUrl(kind);
                              }
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            disabled ||
                            !(
                              kind === "website"
                                ? draft.websiteInput
                                : draft.figmaInput
                            ).trim()
                          }
                          onClick={() => controller.addUrl(kind)}
                        >
                          {labels.add}
                        </Button>
                      </div>
                      {sourceErrors[kind] && (
                        <FieldError id={`${id}-${kind}-error`}>
                          {sourceErrors[kind]}
                        </FieldError>
                      )}
                    </Field>
                  )}
                  {kind === "files" && (
                    <Field>
                      <FieldLabel
                        className="sr-only"
                        htmlFor={`${id}-${kind}-files`}
                      >
                        {labels.chooseFiles}
                      </FieldLabel>
                      <input
                        ref={fileInput}
                        hidden
                        id={`${id}-${kind}-files`}
                        type="file"
                        multiple
                        accept={DESIGN_SYSTEM_BRAND_FILE_ACCEPT}
                        disabled={disabled}
                        onChange={(event) => {
                          controller.chooseFiles(
                            Array.from(event.target.files ?? []),
                            kind,
                          );
                          event.target.value = "";
                        }}
                      />
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <FieldContent>
                          <FieldTitle>{labels.files}</FieldTitle>
                          <FieldDescription>
                            {labels.fileTypes}
                          </FieldDescription>
                        </FieldContent>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => fileInput.current?.click()}
                        >
                          {labels.chooseFiles}
                        </Button>
                      </div>
                      {draft.uploads
                        .filter((upload) => upload.source === kind)
                        .map((upload) => (
                          <div
                            key={upload.id}
                            className="flex items-start gap-2"
                            data-upload-status={upload.status}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="truncate text-sm">
                                {upload.file.name}
                              </span>
                              {upload.error ? (
                                <FieldError>{upload.error}</FieldError>
                              ) : (
                                <span
                                  className="text-sm text-muted-foreground"
                                  role="status"
                                >
                                  {upload.status === "uploading"
                                    ? labels.uploading
                                    : labels.pending}
                                </span>
                              )}
                            </div>
                            {upload.status === "uploading" && <Spinner />}
                            {upload.status === "failed" && upload.retryable && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={disabled}
                                onClick={() =>
                                  void controller.upload(upload.id)
                                }
                              >
                                {labels.retry}
                              </Button>
                            )}
                            <IconButton
                              emphasis="ghost"
                              size="compact"
                              disabled={disabled}
                              label={labels.remove(upload.file.name)}
                              onPress={() => controller.remove(upload.id)}
                              icon={<IconX />}
                            />
                          </div>
                        ))}
                      {draft.uploads.some(
                        (upload) => upload.source === kind,
                      ) && (
                        <div>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              disabled ||
                              draft.uploads.some(
                                (upload) =>
                                  upload.source === kind &&
                                  upload.status === "uploading",
                              )
                            }
                            onClick={() => void controller.addFiles(kind)}
                          >
                            {labels.add}
                          </Button>
                        </div>
                      )}
                    </Field>
                  )}
                  {controller.sourceNotice?.[kind]}
                </section>
              ))}
          </>
        )}
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </div>
      <div
        data-creation-footer
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-4"
      >
        <div>
          {showBack && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={controller.back}
            >
              <IconArrowLeft aria-hidden="true" />
              {step === "start" || addingToSystemId
                ? labels.cancel
                : labels.back}
            </Button>
          )}
        </div>
        <Button
          type="submit"
          className="ms-auto"
          disabled={disabled || !canSubmit}
          aria-busy={submitting}
        >
          {submitting && <Spinner />}
          {submitting
            ? labels.submitting
            : step === "start"
              ? labels.continue
              : addingToSystemId
                ? labels.addToSystem
                : labels.create}
        </Button>
      </div>
    </form>
  );
}

export interface DesignSystemCreationProps extends DesignSystemCreationOptions {
  components?: Partial<DesignSystemCreationComponents>;
  showBack?: boolean;
  render?: (controller: DesignSystemCreationController) => ReactNode;
}

export function DesignSystemCreation({
  components,
  showBack,
  render,
  ...options
}: DesignSystemCreationProps) {
  const controller = useDesignSystemCreation(options);
  return render ? (
    render(controller)
  ) : (
    <DesignSystemCreationView
      controller={controller}
      components={components}
      showBack={showBack}
    />
  );
}
