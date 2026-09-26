import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/core/client/settings";
import { IconPhoto } from "@tabler/icons-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  BRAND_COLOR_PRESETS,
  uploadLogo,
} from "@/components/workspace/branding-editor";
import { organizationLogoUrl } from "@/lib/organization-logo";

import { LoadFailedRow } from "./load-failed-row";
import { ReadOnlyValue } from "./read-only-value";
import {
  useClipsOrganization,
  useSaveClipsBranding,
  type ClipsOrganizationBranding,
} from "./use-clips-organization";

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function LogoMark({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="size-full rounded-md object-contain" />
  ) : (
    <IconPhoto aria-hidden="true" />
  );
}

function LogoControl({
  organization,
  onSave,
  onPreview,
}: {
  organization: ClipsOrganizationBranding;
  onSave: (brandLogoUrl: string | null) => void;
  /** A local preview of the file being uploaded; the logo route serves one URL per organization. */
  onPreview: (previewUrl: string | null) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(t("brandingEditor.uploadImageFile"));
      return;
    }
    setUploading(true);
    onPreview(URL.createObjectURL(file));
    try {
      onSave(await uploadLogo(file, organization.id));
    } catch (err) {
      onPreview(null);
      toast.error(
        err instanceof Error ? err.message : t("brandingEditor.uploadFailed"),
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {organization.brandLogoUrl ? (
        <Button
          type="button"
          variant="secondary-destructive"
          size="sm"
          disabled={uploading}
          onClick={() => {
            onPreview(null);
            onSave(null);
          }}
        >
          {t("brandingEditor.remove")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Spinner /> : null}
        {t("clipsSettings.change")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("brandingEditor.logo")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

function BrandColorControl({
  value,
  onSave,
}: {
  value: string;
  onSave: (brandColor: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit(next: string) {
    const color = next.trim();
    if (color.toLowerCase() === value.toLowerCase()) return;
    if (!HEX_COLOR.test(color)) {
      setDraft(value);
      toast.error(t("clipsSettings.brandColorInvalid"));
      return;
    }
    onSave(color);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        else commit(draft);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          {t("clipsSettings.change")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX_COLOR.test(draft) ? draft : value}
              onChange={(event) => setDraft(event.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
              aria-label={t("brandingEditor.brandColorPicker")}
            />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setOpen(false);
                  commit(draft);
                }
              }}
              aria-label={t("brandingEditor.brandColor")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {BRAND_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className="size-6 rounded-full border border-input bg-(--swatch)"
                style={{ "--swatch": color } as CSSProperties}
                onClick={() => {
                  setDraft(color);
                  setOpen(false);
                  commit(color);
                }}
                aria-label={t("brandingEditor.useColor", { color })}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Clips › General › Sharing: the logo and brand color share emails and
 * public clip pages show. Owners and admins edit; members see them.
 */
export function ClipsSharingGroup() {
  const t = useT();
  const state = useClipsOrganization();
  const save = useSaveClipsBranding(state.organization?.id ?? null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl],
  );

  if (state.hasOrganization === false) return null;

  const title = t("settings.sharing");
  const adminsOnly = t("clipsSettings.adminsOnly");

  if (state.isError) {
    return (
      <SettingsGroup id="sharing" title={title}>
        <LoadFailedRow onRetry={state.refetch} />
      </SettingsGroup>
    );
  }
  if (state.isLoading) {
    return (
      <SettingsGroup id="sharing" title={title}>
        <SettingsLoadingRow />
        <SettingsLoadingRow />
      </SettingsGroup>
    );
  }
  const organization = state.organization;
  if (!organization) return null;

  return (
    <SettingsGroup id="sharing" title={title}>
      <SettingsRow
        id="logo"
        icon={
          <LogoMark
            src={
              logoPreviewUrl ??
              organizationLogoUrl(organization.brandLogoUrl, organization.id)
            }
          />
        }
        label={t("brandingEditor.logo")}
        description={t("clipsSettings.logoDescription")}
        control={
          state.isAdmin ? (
            <LogoControl
              organization={organization}
              onSave={(brandLogoUrl) => save({ brandLogoUrl })}
              onPreview={setLogoPreviewUrl}
            />
          ) : (
            <ReadOnlyValue reason={adminsOnly} />
          )
        }
      />
      <SettingsRow
        id="brand-color"
        icon={
          <span
            aria-hidden="true"
            className="size-4 rounded-full bg-(--swatch)"
            style={{ "--swatch": organization.brandColor } as CSSProperties}
          />
        }
        label={t("brandingEditor.brandColor")}
        description={organization.brandColor.toUpperCase()}
        control={
          state.isAdmin ? (
            <BrandColorControl
              value={organization.brandColor}
              onSave={(brandColor) => save({ brandColor })}
            />
          ) : (
            <ReadOnlyValue reason={adminsOnly} />
          )
        }
      />
    </SettingsGroup>
  );
}
