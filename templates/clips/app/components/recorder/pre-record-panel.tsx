import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconCamera,
  IconDeviceScreen,
  IconMicrophone,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_MIC_DEVICE_ID, type RecordingMode } from "./recorder-engine";

export interface PreRecordPanelProps {
  onStart: (opts: {
    mode: RecordingMode;
    micDeviceId: string | null;
    cameraDeviceId: string | null;
  }) => void;
  /** Called when the user picks a local video file to upload. */
  onUpload?: (file: File) => void;
  onCancel?: () => void;
  busy?: boolean;
}

const MODE_OPTIONS: Array<{
  value: RecordingMode;
  label: string;
  icon: typeof IconDeviceScreen;
  sub: string;
}> = [
  {
    value: "screen",
    label: "Screen",
    icon: IconDeviceScreen,
    sub: "Record your screen",
  },
  {
    value: "screen+camera",
    label: "Screen + Camera",
    icon: IconVideo,
    sub: "Screen with webcam bubble",
  },
  {
    value: "camera",
    label: "Camera",
    icon: IconCamera,
    sub: "Just your webcam",
  },
];

export function PreRecordPanel({
  onStart,
  onUpload,
  onCancel,
  busy,
}: PreRecordPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RecordingMode>("screen+camera");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("default");
  const [cameraId, setCameraId] = useState<string>("default");
  const [enumError, setEnumError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setMics(
          devices.filter(
            (d) =>
              d.kind === "audioinput" && d.deviceId && d.deviceId !== "default",
          ),
        );
        setCameras(
          devices.filter(
            (d) =>
              d.kind === "videoinput" && d.deviceId && d.deviceId !== "default",
          ),
        );
      } catch (err) {
        setEnumError(
          err instanceof Error ? err.message : "Could not enumerate devices",
        );
      }
    }
    void enumerate();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsCamera = mode === "camera" || mode === "screen+camera";

  const startDisabled = useMemo(() => {
    if (busy) return true;
    return false;
  }, [busy]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div>
        <h2 className="text-lg font-semibold">New recording</h2>
        <p className="text-sm text-muted-foreground">
          Pick what to capture, then hit Start.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = opt.value === mode;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={
                "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center " +
                (active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/40")
              }
              aria-pressed={active}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[12px] font-medium">{opt.label}</span>
              <span className="text-[10px] leading-tight text-muted-foreground">
                {opt.sub}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <IconMicrophone className="h-4 w-4 text-muted-foreground" />
          <Select value={micId} onValueChange={setMicId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Default mic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default microphone</SelectItem>
              <SelectItem value={NO_MIC_DEVICE_ID}>No microphone</SelectItem>
              {mics.map((m) => (
                <SelectItem key={m.deviceId} value={m.deviceId}>
                  {m.label || `Mic ${m.deviceId.slice(0, 4)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsCamera && (
          <div className="flex items-center gap-3">
            <IconCamera className="h-4 w-4 text-muted-foreground" />
            <Select value={cameraId} onValueChange={setCameraId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Default camera" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default camera</SelectItem>
                {cameras.map((c) => (
                  <SelectItem key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${c.deviceId.slice(0, 4)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {enumError && (
          <p className="text-[11px] text-destructive">{enumError}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button
          disabled={startDisabled}
          onClick={() =>
            onStart({
              mode,
              micDeviceId: micId === "default" ? null : micId,
              cameraDeviceId: cameraId === "default" ? null : cameraId,
            })
          }
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary"
        >
          Start recording
        </Button>
      </div>

      {onUpload && (
        <>
          <div className="relative flex items-center">
            <div className="flex-1 border-t border-border" />
            <span className="px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <div className="flex-1 border-t border-border" />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2.5 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <IconUpload className="h-4 w-4" />
            Upload a video file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
