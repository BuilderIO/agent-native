import { useState } from "react";
import {
  IconLock,
  IconClock,
  IconMessage,
  IconDownload,
  IconPhoto,
  IconX,
  IconMoodSmile,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActionMutation } from "@agent-native/core/client";
import { SPEED_OPTIONS } from "./player-controls";

export interface SettingsPanelProps {
  recording: {
    id: string;
    password: string | null;
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
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { recording, visibility, ctas, onClose, onRefetch } = props;

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

  const [password, setPassword] = useState(recording.password ?? "");
  const [expiresAt, setExpiresAt] = useState(recording.expiresAt ?? "");

  function patch(fields: Record<string, unknown>) {
    update.mutate({ id: recording.id, ...fields } as any);
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium">Settings</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <IconX className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Privacy */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <IconLock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Privacy
            </h3>
          </div>

          <div>
            <Label className="text-xs">Visibility</Label>
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
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="org">Organization</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Password protection</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="No password"
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => patch({ password: password || null })}
                disabled={update.isPending}
              >
                Save
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1">
              <IconClock className="h-3 w-3" /> Expiry
            </Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="datetime-local"
                value={toDatetimeLocal(expiresAt)}
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
                Save
              </Button>
            </div>
          </div>
        </section>

        <Separator />

        {/* Toggles */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Viewer options
          </h3>
          <ToggleRow
            icon={<IconMessage className="h-4 w-4" />}
            label="Comments"
            checked={recording.enableComments}
            onChange={(v) => patch({ enableComments: v })}
          />
          <ToggleRow
            icon={<IconMoodSmile className="h-4 w-4" />}
            label="Reactions"
            checked={recording.enableReactions}
            onChange={(v) => patch({ enableReactions: v })}
          />
          <ToggleRow
            icon={<IconDownload className="h-4 w-4" />}
            label="Allow downloads"
            checked={recording.enableDownloads}
            onChange={(v) => patch({ enableDownloads: v })}
          />
          <ToggleRow
            icon={<IconPhoto className="h-4 w-4" />}
            label="Animated thumbnail"
            checked={recording.animatedThumbnailEnabled}
            onChange={(v) => patch({ animatedThumbnailEnabled: v })}
          />
        </section>

        <Separator />

        {/* Default speed */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Default playback speed
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
              Call to action
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                createCta.mutate({
                  recordingId: recording.id,
                  label: "Learn more",
                  url: "https://example.com",
                  color: "#625DF5",
                  placement: "throughout",
                } as any)
              }
            >
              + Add
            </Button>
          </div>

          {ctas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No CTAs yet. Add a button that appears during or after the video.
            </p>
          ) : (
            <div className="space-y-3">
              {ctas.map((cta) => (
                <CtaEditor
                  key={cta.id}
                  cta={cta}
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
  onSave: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(cta.label);
  const [url, setUrl] = useState(cta.url);
  const [color, setColor] = useState(cta.color);
  const [placement, setPlacement] = useState(cta.placement);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Button label"
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
            <SelectItem value="throughout">Throughout</SelectItem>
            <SelectItem value="end">At end</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="bg-[#625DF5] hover:bg-[#5751e5] text-white"
          onClick={() => onSave({ label, url, color, placement })}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
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
