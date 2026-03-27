import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { API_BASE } from "@shared/api";
import type { ImportRecord } from "@shared/types";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type UploadState = "idle" | "dragging" | "uploading" | "error";

interface UploadZoneProps {
  onUpload: (record: ImportRecord) => void;
  compact?: boolean;
}

export function UploadZone({ onUpload, compact = false }: UploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".csv")) {
        setState("error");
        setError("Only CSV files are supported.");
        return;
      }

      setState("uploading");
      setError(null);

      try {
        const form = new FormData();
        form.append("file", file);

        const res = await fetch(`${API_BASE}/upload`, {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const record: ImportRecord = await res.json();
        setState("idle");
        onUpload(record);
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [onUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setState("idle");
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState("dragging");
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState("idle");
  }, []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFile],
  );

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onFileChange}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={state === "uploading"}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
        >
          {state === "uploading" ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload CSV
        </button>
      </>
    );
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => state !== "uploading" && inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors",
        state === "dragging" && "border-primary bg-primary/5",
        state === "uploading" && "pointer-events-none opacity-60",
        state === "error" && "border-destructive/50",
        state === "idle" &&
          "border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-accent/30",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={onFileChange}
      />

      {state === "uploading" ? (
        <Spinner className="h-8 w-8" />
      ) : (
        <div className="rounded-full bg-muted p-3">
          <Upload className="h-6 w-6 text-muted-foreground" />
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {state === "uploading"
            ? "Uploading..."
            : "Drop a CSV file here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          CSV files only, up to 10MB
        </p>
      </div>

      {state === "error" && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
