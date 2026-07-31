import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconServer,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SecretStatus } from "@/hooks/use-secret-status";
import type { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { cn } from "@/lib/utils";

import type { BuilderConnection } from "./types";

export const S3_STORAGE_FIELDS = [
  {
    key: "S3_ENDPOINT",
    labelKey: "settings.s3EndpointLabel",
    placeholder: "https://s3.us-east-1.amazonaws.com",
    required: true,
  },
  {
    key: "S3_BUCKET",
    labelKey: "settings.s3BucketLabel",
    placeholder: "my-clips-bucket",
    required: true,
  },
  {
    key: "S3_ACCESS_KEY_ID",
    labelKey: "settings.s3AccessKeyLabel",
    placeholder: "AKIA...",
    required: true,
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    labelKey: "settings.s3SecretAccessKeyLabel",
    placeholder: "••••••••",
    required: true,
    secret: true,
  },
  {
    key: "S3_REGION",
    labelKey: "settings.s3RegionLabel",
    placeholder: "us-east-1",
  },
  {
    key: "S3_PUBLIC_BASE_URL",
    labelKey: "settings.s3PublicBaseUrlLabel",
    placeholder: "https://cdn.example.com",
  },
] as const;

async function saveS3StorageSettings(
  values: Record<string, string>,
): Promise<void> {
  const vars = S3_STORAGE_FIELDS.map((field) => ({
    key: field.key,
    value: (values[field.key] ?? "").trim(),
  })).filter((entry) => entry.value.length > 0);

  if (vars.length === 0) {
    throw new Error("Enter at least one storage value.");
  }

  for (const { key, value } of vars) {
    const res = await fetch(agentNativePath("/_agent-native/secrets/adhoc"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: key,
        value,
        scope: "workspace",
        description: "Clips S3-compatible storage", // i18n-ignore -- secret metadata description, not visible UI
      }),
    });

    if (!res.ok) {
      // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
  }
}

export interface VideoStorageSectionProps {
  builder: BuilderConnection;
  secrets: SecretStatus;
  storageStatus: ReturnType<typeof useVideoStorageStatus>;
}

export function VideoStorageSection({
  builder,
  secrets,
  storageStatus,
}: VideoStorageSectionProps) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const storageConfigured = !!storageStatus.data?.configured;
  const activeProviderName = storageStatus.data?.activeProvider?.name ?? null;
  const s3Configured = storageStatus.data?.activeProvider?.id === "s3";

  function validate(current: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = {};
    for (const key of ["S3_ENDPOINT", "S3_PUBLIC_BASE_URL"]) {
      const value = (current[key] ?? "").trim();
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          next[key] = t("settings.s3UrlInvalid");
        }
      } catch {
        next[key] = t("settings.s3UrlInvalid");
      }
    }
    const bucket = (current["S3_BUCKET"] ?? "").trim();
    if (bucket && !/^[a-z0-9][a-z0-9\-.]{1,61}[a-z0-9]$/.test(bucket)) {
      next["S3_BUCKET"] = t("settings.s3BucketInvalid");
    }
    return next;
  }

  async function handleSave() {
    const validationErrors = validate(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    const missing = s3Configured
      ? []
      : S3_STORAGE_FIELDS.filter(
          (field) =>
            "required" in field &&
            field.required &&
            !(values[field.key] ?? "").trim(),
        );
    if (missing.length > 0) {
      toast.error(t("settings.storageRequired"));
      return;
    }

    setSaving(true);
    try {
      await saveS3StorageSettings(values);
      setValues((current) => ({ ...current, S3_SECRET_ACCESS_KEY: "" }));
      await Promise.all([storageStatus.refetch(), secrets.refresh()]);
      toast.success(t("settings.storageSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      const results = await Promise.all(
        S3_STORAGE_FIELDS.filter((field) => secrets.configured[field.key]).map(
          async (field) => {
            const res = await fetch(
              agentNativePath(
                `/_agent-native/secrets/adhoc/${encodeURIComponent(field.key)}`,
              ),
              { method: "DELETE" },
            );
            if (!res.ok) {
              // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
              const body = (await res.json().catch(() => null)) as {
                error?: string;
              } | null;
              throw new Error(
                body?.error ?? `Failed to clear ${field.key} (${res.status})`,
              );
            }
            // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
            const body = (await res.json().catch(() => null)) as {
              removed?: boolean;
            } | null;
            return { key: field.key, removed: body?.removed !== false };
          },
        ),
      );
      const failed = results.filter((r) => !r.removed).map((r) => r.key);
      if (failed.length > 0) {
        throw new Error(
          `Could not remove: ${failed.join(", ")}. You may not have permission.`,
        );
      }
      setValues({});
      await Promise.all([secrets.refresh(), storageStatus.refetch()]);
      toast.success(t("settings.keyCleared"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.saveFailed"),
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card id="video-storage" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <IconCloud className="size-4 text-primary" />
          {t("settings.videoStorage")}
        </CardTitle>
        <CardDescription>
          {t("settings.videoStorageDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            "flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
            builder.connected
              ? "border-primary/35 bg-primary/5"
              : "border-border bg-accent/30",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              {builder.connected ? (
                <IconCheck className="h-4 w-4 text-primary" />
              ) : (
                <IconKey className="h-4 w-4 text-muted-foreground" />
              )}
              {builder.loading
                ? t("settings.checkingBuilder")
                : builder.connected
                  ? t("settings.builderConnected")
                  : t("settings.connectBuilder")}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {builder.connected
                ? builder.orgName
                  ? t("settings.builderConnectedFor", {
                      orgName: builder.orgName,
                    })
                  : t("settings.builderConnectedGeneric")
                : t("settings.builderIncludes")}
            </p>
          </div>
          {builder.connected ? (
            <Badge variant="secondary" className="shrink-0">
              {t("common.connected")}
            </Badge>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() =>
                builder.start({
                  trackingSource: "clips_settings_video_storage",
                  trackingFlow: "video_storage",
                })
              }
              disabled={builder.connecting || builder.loading}
            >
              {builder.connecting ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconExternalLink className="h-4 w-4" />
              )}
              {t("settings.connectBuilder")}
            </Button>
          )}
        </div>

        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <div className="rounded-md border border-border">
            <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <IconServer className="h-4 w-4 text-muted-foreground" />
                  {t("settings.s3Title")}
                  <Badge variant="outline" className="text-[10px]">
                    {t("settings.secondary")}
                  </Badge>
                  {s3Configured ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {t("settings.active")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {builder.connected
                    ? t("settings.s3BuilderConnectedDescription")
                    : storageConfigured && activeProviderName
                      ? t("settings.s3CurrentProvider", {
                          providerName: activeProviderName,
                        })
                      : t("settings.s3OwnBucketDescription")}
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                >
                  {expanded ? t("settings.hideS3") : t("settings.configureS3")}
                  <IconChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div className="space-y-4 border-t border-border px-3 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {S3_STORAGE_FIELDS.map((field) => {
                    const configured = Boolean(secrets.configured[field.key]);
                    const last4 = secrets.last4[field.key];
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={field.key}>{t(field.labelKey)}</Label>
                          {configured ? (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                              <IconCheck className="h-3 w-3" />
                              {last4 ? `••••${last4}` : t("settings.keySet")}
                            </span>
                          ) : null}
                        </div>
                        <Input
                          id={field.key}
                          type={
                            "secret" in field && field.secret
                              ? "password"
                              : "text"
                          }
                          value={values[field.key] ?? ""}
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }));
                            if (errors[field.key]) {
                              setErrors((current) => {
                                const next = { ...current };
                                delete next[field.key];
                                return next;
                              });
                            }
                          }}
                          placeholder={
                            configured
                              ? t("settings.replaceKey")
                              : field.placeholder
                          }
                          autoComplete="off"
                          disabled={saving}
                          className={
                            errors[field.key] ? "border-destructive" : undefined
                          }
                        />
                        {errors[field.key] ? (
                          <p className="text-[11px] text-destructive">
                            {errors[field.key]}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-end gap-2">
                  {S3_STORAGE_FIELDS.some(
                    (field) => secrets.configured[field.key],
                  ) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearAll}
                      disabled={clearing || saving}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {clearing ? (
                        <IconLoader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <IconTrash className="h-4 w-4" />
                      )}
                      {t("settings.clearAllS3")}
                    </Button>
                  ) : null}
                  <Button
                    onClick={handleSave}
                    disabled={saving || storageStatus.isLoading}
                  >
                    {saving && <IconLoader2 className="h-4 w-4 animate-spin" />}
                    {t("settings.saveStorage")}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
