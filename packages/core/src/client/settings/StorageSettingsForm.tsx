import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconAlertCircle,
  IconBrandAws,
  IconBrandCloudflare,
  IconBrandSupabase,
  IconLock,
  IconServer,
} from "@tabler/icons-react";
import React, { useEffect, useId, useState } from "react";

import type {
  FileStorageField,
  FileStorageProviderId,
  FileStorageStatus,
  SaveFileStorageInput,
} from "../../file-upload/storage-settings.js";
import { useT } from "../i18n.js";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "../use-action.js";
import { cn } from "../utils.js";

interface ManageFileStorageResult {
  removedKeys: string[];
  status: FileStorageStatus;
}

type ManageFileStorageVariables = SaveFileStorageInput & {
  operation: "save" | "clear";
};

const PROVIDERS: ReadonlyArray<{
  id: FileStorageProviderId;
  /** Brand names are not translated; `null` uses the catalog label. */
  name: string | null;
  icon: typeof IconServer;
  endpointPlaceholder: string;
  hintKey: string;
}> = [
  {
    id: "aws-s3",
    name: "Amazon S3", // i18n-ignore -- provider brand name
    icon: IconBrandAws,
    endpointPlaceholder: "https://s3.us-west-2.amazonaws.com",
    hintKey: "agentChat.settings.storage.hintAws",
  },
  {
    id: "cloudflare-r2",
    name: "Cloudflare R2", // i18n-ignore -- provider brand name
    icon: IconBrandCloudflare,
    endpointPlaceholder: "https://<account-id>.r2.cloudflarestorage.com",
    hintKey: "agentChat.settings.storage.hintR2",
  },
  {
    id: "supabase",
    name: "Supabase Storage", // i18n-ignore -- provider brand name
    icon: IconBrandSupabase,
    endpointPlaceholder: "https://<project>.supabase.co/storage/v1/s3",
    hintKey: "agentChat.settings.storage.hintSupabase",
  },
  {
    id: "other",
    name: null,
    icon: IconServer,
    endpointPlaceholder: "https://s3.example.com",
    hintKey: "agentChat.settings.storage.hintOther",
  },
];

/**
 * A storage provider's brand name and icon, for surfaces that name the saved
 * provider. `name` is null for "Other S3-compatible", which is translated.
 */
export function fileStorageProviderPreset(id: FileStorageProviderId): {
  name: string | null;
  icon: typeof IconServer;
} {
  const preset =
    PROVIDERS.find((entry) => entry.id === id) ??
    PROVIDERS.find((entry) => entry.id === "other")!;
  return { name: preset.name, icon: preset.icon };
}

type FormValues = Record<FileStorageField, string>;
type FieldErrors = Partial<Record<FileStorageField, string>>;

const EMPTY_VALUES: FormValues = {
  endpoint: "",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  region: "",
  publicBaseUrl: "",
};

const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    // coercion-ok: an unparseable URL is an explicit validation failure.
    return false;
  }
}

function valuesFromStatus(status: FileStorageStatus): FormValues {
  return {
    ...EMPTY_VALUES,
    endpoint: status.endpoint ?? "",
    bucket: status.bucket ?? "",
    region: status.region ?? "",
    publicBaseUrl: status.publicBaseUrl ?? "",
  };
}

export interface StorageSettingsFormProps {
  /** Called with the new status after a save succeeds. */
  onSaved?: (status: FileStorageStatus) => void;
  /** Called with the new status after Clear credentials succeeds. */
  onCleared?: (status: FileStorageStatus) => void;
  /** Renders a Cancel button, for hosts that show the form in a dialog. */
  onCancel?: () => void;
  /** One column for narrow hosts such as the agent sidebar. Defaults to 2. */
  columns?: 1 | 2;
  className?: string;
}

/**
 * The one S3-compatible storage form. Settings, onboarding, and templates
 * (Clips' Video storage) all mount this, and it reads and writes through the
 * `get-file-storage` and `manage-file-storage` actions the agent also calls.
 */
export function StorageSettingsForm(props: StorageSettingsFormProps) {
  const { className } = props;
  const t = useT();
  const statusQuery = useActionQuery<FileStorageStatus>(
    "get-file-storage" as never,
  );

  if (statusQuery.isError && !statusQuery.data) {
    return (
      <div
        role="alert"
        className={cn("flex items-center justify-between gap-4", className)}
      >
        <span className="text-sm text-destructive">
          {t("agentChat.settings.storage.loadFailed")}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void statusQuery.refetch()}
        >
          {t("agentChat.settings.storage.retry")}
        </Button>
      </div>
    );
  }

  if (!statusQuery.data)
    return <StorageSettingsFormSkeleton className={className} />;

  if (!statusQuery.data.canManage) {
    return (
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <IconLock size={13} aria-hidden />
        {t("agentChat.settings.storage.adminOnly")}
      </p>
    );
  }

  return <LoadedStorageSettingsForm {...props} status={statusQuery.data} />;
}

function LoadedStorageSettingsForm({
  status,
  onSaved,
  onCleared,
  onCancel,
  columns = 2,
  className,
}: StorageSettingsFormProps & { status: FileStorageStatus }) {
  const t = useT();
  const manage = useActionMutation<
    ManageFileStorageResult,
    ManageFileStorageVariables
  >("manage-file-storage" as never);
  const idPrefix = useId();
  const [provider, setProvider] = useState<FileStorageProviderId>(
    status.provider ?? "aws-s3",
  );
  const [values, setValues] = useState<FormValues>(() =>
    valuesFromStatus(status),
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "clear" | null>(null);

  const hasSavedValues = Object.values(status.saved).some(Boolean);
  const preset = PROVIDERS.find((entry) => entry.id === provider)!;

  // Re-seed the non-secret fields when the saved values change, including
  // when the agent or another surface saves them. Typed keys are kept.
  const savedSignature = [
    status.endpoint,
    status.bucket,
    status.region,
    status.publicBaseUrl,
  ].join("\n");
  useEffect(() => {
    if (pending) return;
    setValues((current) => ({
      ...valuesFromStatus(status),
      accessKeyId: current.accessKeyId,
      secretAccessKey: current.secretAccessKey,
    }));
    if (status.provider) setProvider(status.provider);
  }, [savedSignature]);

  const setValue = (field: FileStorageField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
    setNotice(null);
  };

  const trimmed = (field: FileStorageField) => values[field].trim();
  const missingRequired =
    !trimmed("endpoint") ||
    !trimmed("bucket") ||
    (!trimmed("accessKeyId") && !status.saved.accessKeyId) ||
    (!trimmed("secretAccessKey") && !status.saved.secretAccessKey) ||
    (status.publicUrlRequired && !trimmed("publicBaseUrl"));

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!isHttpUrl(trimmed("endpoint"))) {
      errors.endpoint = t("agentChat.settings.storage.invalidUrl");
    }
    if (trimmed("publicBaseUrl") && !isHttpUrl(trimmed("publicBaseUrl"))) {
      errors.publicBaseUrl = t("agentChat.settings.storage.invalidUrl");
    }
    if (!BUCKET_NAME.test(trimmed("bucket"))) {
      errors.bucket = t("agentChat.settings.storage.invalidBucket");
    }
    return errors;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || missingRequired) return;
    const invalid = validate();
    setFieldErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    const input: ManageFileStorageVariables = {
      operation: "save",
      endpoint: values.endpoint.trim(),
      bucket: values.bucket.trim(),
      region: values.region.trim(),
      publicBaseUrl: values.publicBaseUrl.trim(),
    };
    if (values.accessKeyId.trim())
      input.accessKeyId = values.accessKeyId.trim();
    if (values.secretAccessKey.trim()) {
      input.secretAccessKey = values.secretAccessKey.trim();
    }
    setPending("save");
    setError(null);
    setNotice(null);
    manage.mutate(input, {
      onSuccess: (result) => {
        setValues((current) => ({
          ...current,
          accessKeyId: "",
          secretAccessKey: "",
        }));
        setNotice(
          t("agentChat.settings.storage.savedNotice", {
            bucket: result.status.bucket ?? input.bucket,
          }),
        );
        window.dispatchEvent(
          new CustomEvent("agent-engine:configured-changed"),
        );
        onSaved?.(result.status);
      },
      onError: (cause) => {
        setError(
          actionErrorMessage(cause) ??
            t("agentChat.settings.storage.saveFailed"),
        );
      },
      onSettled: () => setPending(null),
    });
  };

  const handleClear = () => {
    if (pending) return;
    setPending("clear");
    setClearError(null);
    setError(null);
    setNotice(null);
    manage.mutate(
      { operation: "clear" },
      {
        onSuccess: (result) => {
          setConfirmClear(false);
          setValues(EMPTY_VALUES);
          setFieldErrors({});
          setNotice(
            result.status.builderUploadConfigured
              ? t("agentChat.settings.storage.clearedBuilder")
              : t("agentChat.settings.storage.cleared"),
          );
          window.dispatchEvent(
            new CustomEvent("agent-engine:configured-changed"),
          );
          onCleared?.(result.status);
        },
        onError: (cause) => {
          setClearError(
            actionErrorMessage(cause) ??
              t("agentChat.settings.storage.clearFailed"),
          );
        },
        onSettled: () => setPending(null),
      },
    );
  };

  const fieldId = (field: FileStorageField) => `${idPrefix}-${field}`;
  const savedPlaceholder = (field: FileStorageField) =>
    status.saved[field] ? t("agentChat.settings.storage.saved") : undefined;
  const providerLabel = (entry: (typeof PROVIDERS)[number]) =>
    entry.name ?? t("agentChat.settings.storage.providerOther");

  const textField = (
    field: FileStorageField,
    label: string,
    options: {
      placeholder?: string;
      hint?: string;
      type?: "text" | "password";
    } = {},
  ) => {
    const fieldError = fieldErrors[field];
    const note = fieldError ?? options.hint;
    const noteId = `${fieldId(field)}-note`;
    return (
      <div className="grid content-start gap-2">
        <Label htmlFor={fieldId(field)}>{label}</Label>
        <Input
          id={fieldId(field)}
          type={options.type ?? "text"}
          value={values[field]}
          onChange={(event) => setValue(field, event.target.value)}
          placeholder={options.placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={pending !== null}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={note ? noteId : undefined}
        />
        {note ? (
          <p
            id={noteId}
            className={cn(
              "text-xs leading-5",
              fieldError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {note}
          </p>
        ) : null}
      </div>
    );
  };

  const bucketName = status.bucket;

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("grid gap-5", className)}
      data-testid="storage-settings-form"
    >
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-provider`}>
          {t("agentChat.settings.storage.provider")}
        </Label>
        <Select
          value={provider}
          onValueChange={(next) => setProvider(next as FileStorageProviderId)}
          disabled={pending !== null}
        >
          <SelectTrigger id={`${idPrefix}-provider`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((entry) => {
              const Icon = entry.icon;
              return (
                <SelectItem key={entry.id} value={entry.id}>
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" aria-hidden />
                    {providerLabel(entry)}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
        {textField("endpoint", t("agentChat.settings.storage.endpoint"), {
          placeholder: preset.endpointPlaceholder,
          hint: t(preset.hintKey),
        })}
        {textField("bucket", t("agentChat.settings.storage.bucket"), {
          placeholder: "my-bucket",
        })}
        {textField("accessKeyId", t("agentChat.settings.storage.accessKeyId"), {
          placeholder: savedPlaceholder("accessKeyId"),
        })}
        {textField(
          "secretAccessKey",
          t("agentChat.settings.storage.secretAccessKey"),
          {
            type: "password",
            placeholder: savedPlaceholder("secretAccessKey"),
          },
        )}
        {textField("region", t("agentChat.settings.storage.region"), {
          placeholder: t("agentChat.settings.storage.optional"),
        })}
        {textField("publicBaseUrl", t("agentChat.settings.storage.publicUrl"), {
          placeholder: status.publicUrlRequired
            ? "https://cdn.example.com"
            : t("agentChat.settings.storage.optional"),
        })}
      </div>
      {error ? (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {hasSavedValues ? (
          <Button
            type="button"
            variant="outline-destructive"
            className="sm:me-auto"
            disabled={pending !== null}
            onClick={() => {
              setClearError(null);
              setConfirmClear(true);
            }}
          >
            {t("agentChat.settings.storage.clear")}
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("agentChat.settings.storage.cancel")}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending !== null || missingRequired}>
          {pending === "save" ? <Spinner aria-hidden /> : null}
          {pending === "save"
            ? t("agentChat.settings.storage.saving")
            : t("agentChat.settings.storage.save")}
        </Button>
      </div>
      <AlertDialog
        open={confirmClear}
        onOpenChange={(open) => {
          if (pending !== "clear") setConfirmClear(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentChat.settings.storage.clearTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {status.builderUploadConfigured
                ? t("agentChat.settings.storage.clearBuilder")
                : t("agentChat.settings.storage.clearNoFallback")}{" "}
              {bucketName
                ? t("agentChat.settings.storage.clearExisting", {
                    bucket: bucketName,
                  })
                : t("agentChat.settings.storage.clearExistingGeneric")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {clearError ? (
            <Alert variant="destructive">
              <IconAlertCircle aria-hidden />
              <AlertDescription>{clearError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild disabled={pending === "clear"}>
              <Button type="button" variant="secondary">
                {t("agentChat.settings.storage.cancel")}
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={pending === "clear"}
              onClick={handleClear}
            >
              {pending === "clear" ? <Spinner aria-hidden /> : null}
              {pending === "clear"
                ? t("agentChat.settings.storage.clearing")
                : t("agentChat.settings.storage.clear")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function StorageSettingsFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-5", className)} aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-16" />
      </div>
    </div>
  );
}
