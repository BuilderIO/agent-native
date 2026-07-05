import {
  useT,
  useActionMutation,
  useReconciledState,
} from "@agent-native/core/client";
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
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  IconLock,
  IconClock,
  IconMessage,
  IconDownload,
  IconPhoto,
  IconX,
  IconMoodSmile,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { SPEED_OPTIONS } from "./player-controls";

export interface SettingsPanelProps {
  recording: {
    id: string;
    /**
     * Whether a password is currently set on the recording. The plaintext
     * password is never sent to the client — the editor sees `hasPassword`
     * and can either replace or clear the password, but never read it.
     */
    hasPassword: boolean;
    expiresAt: string | null;
    enableComments: boolean;
    enableReactions: boolean;
    enableDownloads: boolean;
    defaultSpeed: string;
    animatedThumbnailEnabled: boolean;
  };
  visibility: "private" | "org" | "public";
  ctas: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  }[];
  onClose: () => void;
  onRefetch?: () => void;
  showHeader?: boolean;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const t = useT();
  const {
    recording,
    visibility,
    ctas,
    onClose,
    onRefetch,
    showHeader = true,
  } = props;

  const update = useActionMutation("update-recording", {
    onSuccess: () => onRefetch?.(),
  });
  const setVis = useActionMutation("set-resource-visibility", {
    onSuccess: () => onRefetch?.(),
  });
  const createCta = useActionMutation("create-cta", {
    onSuccess: () => onRefetch?.(),
  });
  const updateCta = useActionMutation("update-cta", {
    onSuccess: () => onRefetch?.(),
  });
  const deleteCta = useActionMutation("delete-cta", {
    onSuccess: () => onRefetch?.(),
  });

  // The plaintext password is never sent to the client (see action
  // `get-recording-player-data`). Start empty; the placeholder communicates
  // whether one is currently set. Saving an empty value clears it, saving a
  // non-empty value replaces it.
  const [password, setPassword] = useState("");
  // Re-adopt the server/agent expiry when the user isn't actively editing the
  // field, so an agent change to `expiresAt` shows up live in the open panel.
  const expiresFocused = useRef(false);
  const [expiresAt, setExpiresAt] = useReconciledState(
    recording.expiresAt ?? "",
    { active: expiresFocused.current },
  );

  function patch(fields: Record<string, unknown>) {
    update.mutate({ id: recording.id, ...fields } as any);
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {showHeader ? (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">{t("playerSettings.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <IconX className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Privacy */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <IconLock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("playerSettings.privacy")}
            </h3>
          </div>

          <div>
            <Label className="text-xs">{t("playerSettings.visibility")}</Label>
            <Select
              value={visibility}
              onValueChange={(v) =>
                setVis.mutate({
                  resourceType: "recording",
                  resourceId: recording.id,
                  visibility: v,
                } as any)
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  {t("playerSettings.visibilityPrivate")}
                </SelectItem>
                <SelectItem value="org">
                  {t("playerSettings.visibilityOrg")}
                </SelectItem>
                <SelectItem value="public">
                  {t("playerSettings.visibilityPublic")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">
              {t("playerSettings.passwordProtection")}
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  recording.hasPassword
                    ? t("playerSettings.passwordSetPlaceholder")
                    : t("playerSettings.noPasswordPlaceholder")
                }
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => {
                  patch({ password: password || null });
                  setPassword("");
                }}
                disabled={update.isPending}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1">
              <IconClock className="h-3 w-3" /> {t("playerSettings.expiry")}
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="datetime-local"
                value={toDatetimeLocal(expiresAt)}
                onFocus={() => {
                  expiresFocused.current = true;
                }}
                onBlur={() => {
                  expiresFocused.current = false;
                }}
                onChange={(e) =>
                  setExpiresAt(fromDatetimeLocal(e.target.value))
                }
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => patch({ expiresAt: expiresAt || null })}
                disabled={update.isPending}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        {/* Toggles */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("playerSettings.viewerOptions")}
          </h3>
          <ToggleRow
            icon={<IconMessage className="h-4 w-4" />}
            label={t("playerSettings.comments")}
            checked={recording.enableComments}
            onChange={(v) => patch({ enableComments: v })}
          />
          <ToggleRow
            icon={<IconMoodSmile className="h-4 w-4" />}
            label={t("playerSettings.reactions")}
            checked={recording.enableReactions}
            onChange={(v) => patch({ enableReactions: v })}
          />
          <ToggleRow
            icon={<IconDownload className="h-4 w-4" />}
            label={t("playerSettings.allowDownloads")}
            checked={recording.enableDownloads}
            onChange={(v) => patch({ enableDownloads: v })}
          />
          <ToggleRow
            icon={<IconPhoto className="h-4 w-4" />}
            label={t("playerSettings.animatedThumbnail")}
            checked={recording.animatedThumbnailEnabled}
            onChange={(v) => patch({ animatedThumbnailEnabled: v })}
          />
        </section>

        <Separator />

        {/* Default speed */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("playerSettings.defaultPlaybackSpeed")}
          </h3>
          <Select
            value={recording.defaultSpeed}
            onValueChange={(v) => patch({ defaultSpeed: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEED_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <Separator />

        {/* CTA editor */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("playerSettings.callToAction")}
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                createCta.mutate({
                  recordingId: recording.id,
                  label: t("playerSettings.defaultCtaLabel"),
                  url: "https://example.com",
                  color: "hsl(var(--primary))",
                  placement: "throughout",
                } as any)
              }
            >
              {t("playerSettings.addCta")}
            </Button>
          </div>

          {ctas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("playerSettings.noCtas")}
            </p>
          ) : (
            <div className="space-y-3">
              {ctas.map((cta) => (
                <CtaEditor
                  key={cta.id}
                  cta={cta}
                  t={t}
                  onSave={(fields) =>
                    updateCta.mutate({ id: cta.id, ...fields } as any)
                  }
                  onDelete={() => deleteCta.mutate({ id: cta.id } as any)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        {label}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function CtaEditor({
  cta,
  t,
  onSave,
  onDelete,
}: {
  cta: {
    id: string;
    label: string;
    url: string;
    color: string;
    placement: "end" | "throughout";
  };
  t: ReturnType<typeof useT>;
  onSave: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  // Re-adopt the server/agent CTA fields whenever the user isn't actively
  // editing this card, so an agent edit to the CTA shows up live. `editing`
  // flips true while focus is anywhere inside the card.
  const editing = useRef(false);
  const [label, setLabel] = useReconciledState(cta.label, {
    active: editing.current,
  });
  const [url, setUrl] = useReconciledState(cta.url, {
    active: editing.current,
  });
  const [color, setColor] = useReconciledState(cta.color, {
    active: editing.current,
  });
  const [placement, setPlacement] = useReconciledState(cta.placement, {
    active: editing.current,
  });

  return (
    <div
      className="rounded-lg border border-border bg-card p-3 space-y-2"
      onFocusCapture={() => {
        editing.current = true;
      }}
      onBlurCapture={(e) => {
        // Only clear when focus leaves the card entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          editing.current = false;
        }
      }}
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("playerSettings.buttonLabelPlaceholder")}
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
      />
      <div className="flex gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-12 rounded cursor-pointer border border-border"
        />
        <Select
          value={placement}
          onValueChange={(v) => setPlacement(v as "end" | "throughout")}
        >
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="throughout">
              {t("playerSettings.placementThroughout")}
            </SelectItem>
            <SelectItem value="end">
              {t("playerSettings.placementEnd")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => onSave({ label, url, color, placement })}
        >
          {t("common.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t("playerSettings.delete")}
        </Button>
      </div>
    </div>
  );
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string {
  if (!v) return "";
  return new Date(v).toISOString();
}
