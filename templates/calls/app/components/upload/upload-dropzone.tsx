import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconUpload,
  IconFile,
  IconCircleCheck,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ACCEPTED =
  "video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,audio/webm,.mp4,.webm,.mov,.mp3,.m4a,.wav";

const CHUNK_SIZE = 5 * 1024 * 1024;
const DIRECT_UPLOAD_THRESHOLD = 50 * 1024 * 1024;

type ItemStatus = "queued" | "uploading" | "processing" | "done" | "error";

interface QueueItem {
  localId: string;
  file: File;
  callId: string | null;
  progress: number;
  status: ItemStatus;
  error?: string;
  bytesSent: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function detectMediaKind(file: File): "audio" | "video" {
  if (file.type.startsWith("audio/")) return "audio";
  const name = file.name.toLowerCase();
  if (/\.(mp3|m4a|wav)$/.test(name)) return "audio";
  return "video";
}

function detectFormat(file: File): string {
  const m = file.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : (file.type.split("/")[1] ?? "");
}

interface UploadDropzoneProps {
  folderId?: string | null;
  workspaceId?: string | null;
  onStarted?: (callId: string) => void;
  className?: string;
}

export function UploadDropzone({
  folderId,
  workspaceId,
  onStarted,
  className,
}: UploadDropzoneProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigatedRef = useRef(false);

  const createCall = useActionMutation<
    { id: string; uploadChunkUrl: string },
    {
      title: string;
      folderId?: string | null;
      workspaceId?: string | null;
      source: "upload";
      mediaKind: "video" | "audio";
      mediaFormat: string;
    }
  >("create-call");

  const updateItem = useCallback(
    (localId: string, patch: Partial<QueueItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  const processFile = useCallback(
    async (item: QueueItem) => {
      try {
        updateItem(item.localId, { status: "uploading" });
        const created = await createCall.mutateAsync({
          title: item.file.name.replace(/\.[^.]+$/, "") || "Untitled call",
          folderId: folderId ?? null,
          workspaceId: workspaceId ?? undefined,
          source: "upload",
          mediaKind: detectMediaKind(item.file),
          mediaFormat: detectFormat(item.file),
        });
        const callId = created.id;
        updateItem(item.localId, { callId });
        onStarted?.(callId);

        let uploadedWithDirect = false;
        if (item.file.size > DIRECT_UPLOAD_THRESHOLD) {
          try {
            const resp = await fetch("/api/uploads/direct", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                callId,
                contentType: item.file.type,
                sizeBytes: item.file.size,
              }),
            });
            const data = (await resp.json().catch(() => ({}))) as any;
            if (data?.mode === "direct" && typeof data.uploadUrl === "string") {
              await uploadDirect({
                url: data.uploadUrl,
                headers: data.headers ?? {},
                file: item.file,
                onProgress: (pct, bytes) =>
                  updateItem(item.localId, {
                    progress: pct,
                    bytesSent: bytes,
                  }),
              });
              await fetch(`/api/uploads/${callId}/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  mediaUrl: data.publicUrl ?? null,
                  sizeBytes: item.file.size,
                  mediaFormat: detectFormat(item.file),
                }),
              }).catch(() => {});
              uploadedWithDirect = true;
            }
          } catch {
            // fall through to chunked
          }
        }

        if (!uploadedWithDirect) {
          await uploadChunked({
            callId,
            file: item.file,
            onProgress: (pct, bytes) =>
              updateItem(item.localId, { progress: pct, bytesSent: bytes }),
          });
        }

        updateItem(item.localId, {
          status: "processing",
          progress: 100,
          bytesSent: item.file.size,
        });

        qc.invalidateQueries({ queryKey: ["action", "list-calls"] });

        updateItem(item.localId, { status: "done" });

        if (!navigatedRef.current) {
          navigatedRef.current = true;
          navigate(`/calls/${callId}`);
        }
      } catch (err) {
        updateItem(item.localId, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [createCall, folderId, navigate, onStarted, qc, updateItem, workspaceId],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const queued: QueueItem[] = list.map((file) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        callId: null,
        progress: 0,
        status: "queued",
        bytesSent: 0,
      }));
      setItems((prev) => [...queued, ...prev]);
      navigatedRef.current = false;

      for (const item of queued) {
        void processFile(item);
      }
    },
    [processFile],
  );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center text-center rounded-xl border-2 border-dashed px-8 py-16 cursor-pointer outline-none",
          dragActive
            ? "border-foreground bg-accent/40"
            : "border-border bg-muted/20 hover:bg-accent/30",
        )}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background border border-border mb-4">
          <IconUpload className="h-7 w-7 text-foreground" />
        </div>
        <div className="text-base font-semibold text-foreground">
          Drop call recordings here
        </div>
        <div className="mt-1 text-sm text-muted-foreground max-w-md">
          Accepts mp4, mov, webm, mp3, m4a, wav. Large files upload in chunks —
          feel free to drop several at once.
        </div>
        <Button className="mt-4 gap-1.5" size="sm" type="button">
          <IconUpload className="h-4 w-4" />
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept={ACCEPTED}
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.localId}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                {item.status === "done" ? (
                  <IconCircleCheck className="h-5 w-5 text-foreground" />
                ) : item.status === "error" ? (
                  <IconAlertTriangle className="h-5 w-5 text-destructive" />
                ) : (
                  <IconFile className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium text-foreground">
                    {item.file.name}
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatBytes(item.bytesSent)} /{" "}
                    {formatBytes(item.file.size)}
                  </div>
                </div>
                {item.status === "error" ? (
                  <div className="mt-1 text-xs text-destructive">
                    {item.error}
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={item.progress} className="h-1.5 flex-1" />
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {statusLabel(item)}
                    </span>
                  </div>
                )}
              </div>
              {item.callId && item.status !== "error" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => navigate(`/calls/${item.callId}`)}
                >
                  Open
                </Button>
              )}
              {item.status === "error" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Remove"
                  onClick={() =>
                    setItems((prev) =>
                      prev.filter((i) => i.localId !== item.localId),
                    )
                  }
                >
                  <IconX className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusLabel(item: QueueItem): string {
  if (item.status === "queued") return "Queued";
  if (item.status === "uploading") return `${item.progress}%`;
  if (item.status === "processing") return "Processing";
  if (item.status === "done") return "Ready";
  return "Error";
}

function uploadDirect({
  url,
  headers,
  file,
  onProgress,
}: {
  url: string;
  headers: Record<string, string>;
  file: File;
  onProgress: (pct: number, bytes: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (!("Content-Type" in headers) && file.type) {
      xhr.setRequestHeader("Content-Type", file.type);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct, e.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Direct upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

async function uploadChunked({
  callId,
  file,
  onProgress,
}: {
  callId: string;
  file: File;
  onProgress: (pct: number, bytes: number) => void;
}): Promise<void> {
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let sent = 0;
  for (let index = 0; index < total; index++) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const isFinal = index === total - 1 ? 1 : 0;
    const params = new URLSearchParams({
      index: String(index),
      total: String(total),
      isFinal: String(isFinal),
      mimeType: file.type || "application/octet-stream",
    });
    if (isFinal) {
      params.set("mediaFormat", detectFormat(file));
      params.set("sizeBytes", String(file.size));
    }

    const res = await fetch(
      `/api/uploads/${callId}/chunk?${params.toString()}`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: await blob.arrayBuffer(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Chunk ${index + 1}/${total} failed: ${text || res.statusText}`,
      );
    }
    sent += blob.size;
    onProgress(Math.round((sent / file.size) * 100), sent);
  }
}
