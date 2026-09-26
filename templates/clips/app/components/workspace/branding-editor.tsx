import { appApiPath } from "@agent-native/core/client/api-path";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { FileStorageSetupCard } from "@agent-native/core/client/setup-connections";
import { IconPalette, IconPhoto } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StorageStatusRetry } from "@/components/recorder/storage-status-retry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";
import { organizationLogoUrl } from "@/lib/organization-logo";

export type RecordingVisibility = "private" | "org" | "public";

interface BrandingEditorProps {
  organizationId: string;
  initialName: string;
  initialBrandColor: string;
  initialBrandLogoUrl: string | null;
  initialDefaultVisibility?: RecordingVisibility;
  disabled?: boolean;
}

const DEFAULT_VISIBILITY: RecordingVisibility = "public";

const PRESETS = [
  "#18181B",
  "#22C55E",
  "#F97316",
  "#EC4899",
  "#0EA5E9",
  "#EF4444",
  "#111827",
];

async function uploadLogo(file: File, organizationId: string): Promise<string> {
  const body = await file.arrayBuffer();
  const query = new URLSearchParams({
    organizationId,
    filename: file.name,
  });
  const res = await fetch(appApiPath(`/api/media?${query}`), {
    method: "POST",
    body,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!res.ok) {
    const responseText = await res.text();
    let errorMessage: string | undefined;
    try {
      const body: unknown = JSON.parse(responseText);
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        errorMessage = body.error;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(errorMessage ?? `Upload failed (${res.status})`);
  }
  const json = (await res.json()) as { reference?: string };
  if (!json.reference) throw new Error("Upload returned no reference");
  return json.reference;
}

export function BrandingEditor({
  organizationId,
  initialName,
  initialBrandColor,
  initialBrandLogoUrl,
  initialDefaultVisibility = DEFAULT_VISIBILITY,
  disabled,
}: BrandingEditorProps) {
  const t = useT();
  const storageQuery = useVideoStorageStatus();
  const storageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const [name, setName] = useState(initialName);
  const [brandColor, setBrandColor] = useState(initialBrandColor);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(
    initialBrandLogoUrl,
  );
  const [defaultVisibility, setDefaultVisibility] =
    useState<RecordingVisibility>(initialDefaultVisibility);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    },
    [uploadPreviewUrl],
  );

  // The last-saved values the Save button compares against to show the
  // dirty state. Re-seeded after every successful save so the button
  // returns to neutral instead of staying "dirty" against the original props.
  const [savedState, setSavedState] = useState({
    name: initialName,
    brandColor: initialBrandColor,
    brandLogoUrl: initialBrandLogoUrl,
    defaultVisibility: initialDefaultVisibility,
  });

  useEffect(() => {
    setDefaultVisibility(initialDefaultVisibility);
    setSavedState((current) => ({
      ...current,
      defaultVisibility: initialDefaultVisibility,
    }));
  }, [initialDefaultVisibility]);

  const isDirty =
    name !== savedState.name ||
    brandColor !== savedState.brandColor ||
    brandLogoUrl !== savedState.brandLogoUrl ||
    defaultVisibility !== savedState.defaultVisibility;
  const logoUrl =
    uploadPreviewUrl ?? organizationLogoUrl(brandLogoUrl, organizationId);

  const qc = useQueryClient();
  const save = useActionMutation<
    any,
    {
      organizationId: string;
      name?: string;
      brandColor?: string;
      brandLogoUrl?: string | null;
      defaultVisibility?: RecordingVisibility;
    }
  >("set-organization-branding");

  async function handleFile(file: File) {
    if (!storageConfigured) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("brandingEditor.uploadImageFile"));
      return;
    }
    setUploadPreviewUrl(URL.createObjectURL(file));
    try {
      setUploading(true);
      const reference = await uploadLogo(file, organizationId);
      setBrandLogoUrl(reference);
      toast.success(t("brandingEditor.logoUploaded"));
    } catch (err) {
      setUploadPreviewUrl(null);
      const storageSetupRequired =
        err instanceof Error &&
        err.message.includes("No object storage is connected");
      if (storageSetupRequired) {
        await storageQuery.refetch();
        toast.error(t("brandingEditor.uploadFailed"), {
          description: t("storageSetup.whyDescription"),
        });
        return;
      }
      toast.error(
        err instanceof Error ? err.message : t("brandingEditor.uploadFailed"),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        organizationId,
        name: name.trim() || undefined,
        brandColor,
        brandLogoUrl,
        defaultVisibility,
      });
      setSavedState({ name, brandColor, brandLogoUrl, defaultVisibility });
      setUploadPreviewUrl(null);
      toast.success(t("brandingEditor.brandingUpdated"));
      void qc.invalidateQueries({
        queryKey: ["action", "list-organization-state"],
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("brandingEditor.saveFailed"),
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <IconPalette className="size-4 text-primary" />
          {t("brandingEditor.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">
              {t("brandingEditor.organizationName")}
            </Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("brandingEditor.brandColor")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={disabled}
                className="h-9 w-16 rounded-md border border-input bg-background p-1 cursor-pointer"
                aria-label={t("brandingEditor.brandColorPicker")}
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                disabled={disabled}
                className="max-w-[120px] tabular-nums uppercase"
              />
              <div className="flex items-center gap-1 ms-2">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border border-input"
                    style={{ background: c }}
                    onClick={() => setBrandColor(c)}
                    aria-label={t("brandingEditor.useColor", { color: c })}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("brandingEditor.logo")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("brandingEditor.logoUsage")}
            </p>
            {storageQuery.isError ? (
              <StorageStatusRetry onRetry={() => void storageQuery.refetch()} />
            ) : storageQuery.isLoading ? null : !storageConfigured ? (
              <FileStorageSetupCard />
            ) : null}
            <div
              className={`rounded-md border border-dashed p-4 flex items-center gap-4 ${
                dragging ? "bg-primary/5 border-primary" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                if (storageConfigured && !disabled) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && storageConfigured && !disabled) {
                  void handleFile(file);
                }
              }}
            >
              <div
                className="h-14 w-14 rounded-md flex items-center justify-center border bg-muted/30"
                style={{
                  background: logoUrl ? undefined : brandColor + "20",
                }}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={t("brandingEditor.logoPreview")}
                    className="max-h-12 max-w-12 object-contain"
                  />
                ) : (
                  <IconPhoto className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-muted-foreground">
                  {brandLogoUrl
                    ? t("brandingEditor.dropReplace")
                    : t("brandingEditor.dropHere")}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label
                    htmlFor="logo-upload"
                    aria-disabled={
                      disabled || uploading || !storageConfigured
                        ? true
                        : undefined
                    }
                    className={`inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-pointer hover:bg-accent ${
                      disabled || uploading || !storageConfigured
                        ? "pointer-events-none opacity-50"
                        : ""
                    }`}
                  >
                    {uploading
                      ? t("brandingEditor.uploading")
                      : t("brandingEditor.chooseFile")}
                  </Label>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={disabled || uploading || !storageConfigured}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                  {brandLogoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setBrandLogoUrl(null);
                        setUploadPreviewUrl(null);
                      }}
                      disabled={disabled}
                    >
                      {t("brandingEditor.remove")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default-visibility">
              {t("brandingEditor.defaultVisibility")}
            </Label>
            <Select
              value={defaultVisibility}
              onValueChange={(value) =>
                setDefaultVisibility(value as RecordingVisibility)
              }
              disabled={disabled}
            >
              <SelectTrigger id="default-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  {t("playerSettings.visibilityPublic")}
                </SelectItem>
                <SelectItem value="org">
                  {t("playerSettings.visibilityOrg")}
                </SelectItem>
                <SelectItem value="private">
                  {t("playerSettings.visibilityPrivate")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("brandingEditor.defaultVisibilityDescription")}
            </p>
          </div>

          <div className="rounded-md border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {t("brandingEditor.preview")}
            </div>
            <div
              className="rounded-md p-3 flex items-center gap-3 text-white"
              style={{ background: brandColor }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-8 w-8 rounded bg-white/90 object-contain p-1"
                />
              ) : (
                <div
                  className="h-8 w-8 rounded bg-white/90 flex items-center justify-center font-semibold text-[13px]"
                  style={{ color: brandColor }}
                >
                  {name.slice(0, 1).toUpperCase() || "C"}
                </div>
              )}
              <div className="font-medium truncate">
                {name || t("brandingEditor.organizationFallback")}
              </div>
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mt-4 mb-2">
              {t("brandingEditor.emailHeaderPreview")}
            </div>
            <div className="rounded-md border border-[#27272a] bg-[#0a0a0c] p-4 flex items-center justify-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-7 w-7 object-contain" />
              ) : (
                <div
                  className="h-7 w-7 rounded bg-white/90 flex items-center justify-center font-semibold text-[12px]"
                  style={{ color: brandColor }}
                >
                  {name.slice(0, 1).toUpperCase() || "C"}
                </div>
              )}
              <span className="font-semibold text-[#fafafa] truncate">
                {name || t("brandingEditor.organizationFallback")}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant={isDirty ? "default" : "secondary"}
              disabled={disabled || save.isPending || !isDirty}
            >
              {save.isPending
                ? t("brandingEditor.saving")
                : isDirty
                  ? t("brandingEditor.save")
                  : t("brandingEditor.saved")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
