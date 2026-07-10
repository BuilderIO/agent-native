import { useT } from "@agent-native/core/client";
import type {
  ContentDatabaseView,
  DocumentProperty,
  DocumentPropertyOption,
  DocumentPropertyValue,
} from "@shared/api";
import { contentDatabaseFormQuestions } from "@shared/database-form";
import {
  IconCheck,
  IconChevronDown,
  IconExternalLink,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitContentDatabaseForm } from "@/hooks/use-content-database";
import { cn } from "@/lib/utils";

import { OPTION_COLOR_CLASSES } from "../DocumentProperties";

interface DatabaseFormViewProps {
  databaseId: string;
  databaseDocumentId: string;
  databaseTitle: string;
  view: ContentDatabaseView;
  properties: DocumentProperty[];
  canEdit: boolean;
}

function valueIsEmpty(value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function optionValueIds(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter(
      (candidate): candidate is string => typeof candidate === "string",
    );
  }
  return typeof value === "string" && value ? [value] : [];
}

function QuestionLabel({
  label,
  required,
  htmlFor,
}: {
  label: string;
  required: boolean;
  htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
      {label}
      {required ? (
        <span className="ms-1 text-destructive" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
}

function OptionQuestion({
  id,
  property,
  value,
  invalid,
  errorId,
  onChange,
}: {
  id: string;
  property: DocumentProperty;
  value: unknown;
  invalid: boolean;
  errorId?: string;
  onChange: (value: DocumentPropertyValue) => void;
}) {
  const t = useT();
  const options = property.definition.options.options ?? [];
  const multiple = property.definition.type === "multi_select";
  const selectedIds = optionValueIds(value);
  const selectedOptions = selectedIds.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? [option] : [];
  });

  function choose(option: DocumentPropertyOption) {
    if (!multiple) {
      onChange(option.id);
      return;
    }
    onChange(
      selectedIds.includes(option.id)
        ? selectedIds.filter((id) => id !== option.id)
        : [...selectedIds, option.id],
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 font-normal"
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selectedOptions.length > 0 ? (
              selectedOptions.map((option) => (
                <span
                  key={option.id}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs",
                    OPTION_COLOR_CLASSES[option.color],
                  )}
                >
                  {option.name}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">
                {t("database.formChooseOption")}
              </span>
            )}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={(event) => {
                if (multiple) event.preventDefault();
                choose(option);
              }}
            >
              <span
                className={cn(
                  "me-2 rounded px-1.5 py-0.5 text-xs",
                  OPTION_COLOR_CLASSES[option.color],
                )}
              >
                {option.name}
              </span>
              {selected ? <IconCheck className="ms-auto size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropertyQuestion({
  property,
  value,
  invalid,
  errorId,
  onChange,
}: {
  property: DocumentProperty;
  value: unknown;
  invalid: boolean;
  errorId?: string;
  onChange: (value: DocumentPropertyValue) => void;
}) {
  const t = useT();
  const type = property.definition.type;
  const id = `database-form-${property.definition.id}`;
  if (type === "select" || type === "status" || type === "multi_select") {
    return (
      <OptionQuestion
        id={id}
        property={property}
        value={value}
        invalid={invalid}
        errorId={errorId}
        onChange={onChange}
      />
    );
  }
  if (type === "checkbox") {
    const checked = value === true;
    return (
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onChange(!checked)}
      >
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded border border-input",
            checked && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {checked ? <IconCheck className="size-3" /> : null}
        </span>
        {checked ? t("database.formChecked") : t("database.formNotChecked")}
      </button>
    );
  }
  if (type === "blocks" || type === "files_media" || type === "person") {
    return (
      <Textarea
        id={id}
        value={
          Array.isArray(value)
            ? value.join("\n")
            : typeof value === "string"
              ? value
              : ""
        }
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={
          type === "blocks"
            ? t("database.formLongAnswerPlaceholder")
            : t("database.formOnePerLinePlaceholder")
        }
        onChange={(event) =>
          onChange(
            type === "blocks"
              ? event.target.value
              : event.target.value
                  .split(/\r?\n/)
                  .map((item) => item.trim())
                  .filter(Boolean),
          )
        }
      />
    );
  }
  return (
    <Input
      id={id}
      type={
        type === "number"
          ? "number"
          : type === "date"
            ? "date"
            : type === "email"
              ? "email"
              : type === "url"
                ? "url"
                : type === "phone"
                  ? "tel"
                  : "text"
      }
      value={
        typeof value === "number" || typeof value === "string" ? value : ""
      }
      aria-invalid={invalid}
      aria-describedby={invalid ? errorId : undefined}
      onChange={(event) =>
        onChange(
          type === "number"
            ? event.target.value
              ? Number(event.target.value)
              : null
            : event.target.value,
        )
      }
    />
  );
}

export function DatabaseFormView({
  databaseId,
  databaseDocumentId,
  databaseTitle,
  view,
  properties,
  canEdit,
}: DatabaseFormViewProps) {
  const t = useT();
  const navigate = useNavigate();
  const submit = useSubmitContentDatabaseForm(databaseDocumentId);
  const questions = useMemo(
    () => contentDatabaseFormQuestions(view, properties),
    [properties, view],
  );
  const visibleQuestions = questions.filter((question) => question.enabled);
  const propertyById = useMemo(
    () =>
      new Map(properties.map((property) => [property.definition.id, property])),
    [properties],
  );
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, DocumentPropertyValue>>(
    {},
  );
  const [invalidKeys, setInvalidKeys] = useState<string[]>([]);
  const [createdDocumentId, setCreatedDocumentId] = useState<string | null>(
    null,
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = visibleQuestions.flatMap((question) => {
      if (!question.required) return [];
      const value = question.key === "name" ? title : values[question.key];
      return valueIsEmpty(value) ? [question.key] : [];
    });
    setInvalidKeys(missing);
    if (missing.length > 0) return;

    const result = await submit.mutateAsync({
      databaseId,
      viewId: view.id,
      title,
      propertyValues: values,
    });
    setCreatedDocumentId(result.createdDocumentId);
    setTitle("");
    setValues({});
    setInvalidKeys([]);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-8 grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {databaseTitle}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("database.formDescription")}
        </p>
      </div>

      {createdDocumentId ? (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/35 p-4">
          <div className="grid gap-0.5">
            <div className="text-sm font-medium">
              {t("database.formSubmitted")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("database.formSubmittedDescription")}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(`/page/${createdDocumentId}`)}
          >
            <IconExternalLink className="size-4" />
            {t("database.openPage")}
          </Button>
        </div>
      ) : null}

      <form
        className="grid gap-6"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        {visibleQuestions.map((question) => {
          const invalid = invalidKeys.includes(question.key);
          const errorId = `database-form-${question.key}-error`;
          if (question.key === "name") {
            return (
              <div key={question.key} className="grid gap-2">
                <QuestionLabel
                  htmlFor="database-form-name"
                  label={t("database.formName")}
                  required={question.required}
                />
                <Input
                  id="database-form-name"
                  value={title}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(event) => setTitle(event.target.value)}
                />
                {invalid ? (
                  <p id={errorId} className="text-xs text-destructive">
                    {t("database.formRequiredError")}
                  </p>
                ) : null}
              </div>
            );
          }
          const property = propertyById.get(question.key);
          if (!property) return null;
          return (
            <div key={question.key} className="grid gap-2">
              <QuestionLabel
                htmlFor={`database-form-${question.key}`}
                label={property.definition.name}
                required={question.required}
              />
              <PropertyQuestion
                property={property}
                value={values[question.key]}
                invalid={invalid}
                errorId={errorId}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    [question.key]: value,
                  }))
                }
              />
              {invalid ? (
                <p id={errorId} className="text-xs text-destructive">
                  {t("database.formRequiredError")}
                </p>
              ) : null}
            </div>
          );
        })}

        {submit.error ? (
          <p role="alert" className="text-sm text-destructive">
            {submit.error instanceof Error
              ? submit.error.message
              : t("database.formSubmitFailed")}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={!canEdit || submit.isPending}>
            {submit.isPending
              ? t("database.formSubmitting")
              : t("database.formSubmit")}
          </Button>
          {!canEdit ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("database.formEditorAccessRequired")}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
