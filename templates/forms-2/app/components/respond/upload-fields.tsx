import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  fileAnswerName,
  MAX_UPLOAD_MB,
  isFileAnswer,
  safeMediaUrl,
  type AnswerValue,
} from "@shared/form-model";
import { IconLoader2, IconUpload, IconX } from "@tabler/icons-react";
import { useRef, useState, type PointerEvent } from "react";

import { sonnerToast } from "@/components/ui/sonner";
import { FIELD_SURFACE } from "@/lib/field-surface";
import { cn } from "@/lib/utils";

import type { FieldProps } from "./answer-fields";
import { passwordFor, sessionIdFor } from "./respond-storage";
import { useUploadGate } from "./upload-gate";

const payloadOf = (props: Pick<FieldProps, "question">) =>
  props.question.settings.payload as Record<string, unknown>;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(
        typeof reader.result === "string"
          ? reader.result.replace(/^data:[^,]*,/, "")
          : "",
      );
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function matchesType(file: File, allowed: unknown): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.some(
    (entry) =>
      typeof entry === "string" &&
      (entry.endsWith("/*")
        ? file.type.startsWith(entry.slice(0, -1))
        : file.type === entry),
  );
}

export function fileLimits(settings: Record<string, unknown>) {
  const multiple = settings.allowMultiple === true;
  return {
    multiple,
    maxFiles: multiple
      ? typeof settings.maxFiles === "number"
        ? settings.maxFiles
        : 20
      : 1,
    maxSizeMb: Math.min(
      typeof settings.maxSizeMb === "number" ? settings.maxSizeMb : 10,
      MAX_UPLOAD_MB,
    ),
    accept: Array.isArray(settings.allowedTypes)
      ? settings.allowedTypes.join(",")
      : "",
  };
}

/** An uploaded file as the respondent sees it: the URL we store and the name they picked. */
type PickedFile = { url: string; name: string };

/** A stored answer as picker rows; files stored before we kept names fall back. */
function storedFiles(value: AnswerValue): PickedFile[] {
  if (!isFileAnswer(value)) return [];
  return value.files.map((url, index) => ({
    url,
    name: fileAnswerName(value, index),
  }));
}

/** The choose-file control. `upload` is absent in the editor, which only shows the gate. */
export function FilePicker({
  settings,
  files,
  invalid,
  describedBy,
  label,
  formId,
  upload,
  onChange,
}: {
  settings: Record<string, unknown>;
  files: PickedFile[];
  invalid: boolean;
  describedBy?: string | undefined;
  label: string;
  formId?: string | null | undefined;
  upload?: ((file: File) => Promise<string>) | undefined;
  onChange: (files: PickedFile[]) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const { anchor, gate, popover } = useUploadGate(formId);
  const [busy, setBusy] = useState(false);
  const limits = fileLimits(settings);

  async function add(picked: File[]) {
    if (!upload) return;
    const room = limits.maxFiles - files.length;
    const next = [...files];
    setBusy(true);
    try {
      for (const file of picked.slice(0, Math.max(room, 0))) {
        if (file.size > limits.maxSizeMb * 1024 * 1024)
          sonnerToast.error(
            t("forms.richBlocks.respond.tooLarge", { mb: limits.maxSizeMb }),
          );
        else if (!matchesType(file, settings.allowedTypes))
          sonnerToast.error(t("forms.richBlocks.respond.wrongType"));
        else
          try {
            // Keep the name the respondent chose; the hosted URL ends in an
            // asset key, which is not something a person can read.
            next.push({ url: await upload(file), name: file.name });
          } catch {
            // coercion-ok: a failed upload shows a toast and keeps the files already added.
            sonnerToast.error(t("forms.richBlocks.respond.uploadFailed"));
          }
      }
    } finally {
      setBusy(false);
      onChange(next);
    }
  }

  return (
    <div ref={anchor} className="flex flex-col items-start gap-2">
      <input
        ref={input}
        type="file"
        hidden
        multiple={limits.multiple}
        accept={limits.accept}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = "";
          void add(picked);
        }}
      />
      <button
        type="button"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={busy}
        onClick={() => gate(() => upload && input.current?.click())}
        className={cn(
          "forms-input flex h-9 items-center gap-2 px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive",
          FIELD_SURFACE,
        )}
      >
        {busy ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : (
          <IconUpload className="size-4" />
        )}
        {label}
      </button>
      <span className="text-sm text-muted-foreground">
        {t("forms.richBlocks.respond.sizeLimit", { mb: limits.maxSizeMb })}
      </span>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.url} className="flex items-center gap-2 text-sm">
              <span className="max-w-[320px] truncate">{file.name}</span>
              <button
                type="button"
                aria-label={t("forms.richBlocks.respond.removeFile", {
                  name: file.name,
                })}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                onClick={() =>
                  onChange(files.filter((other) => other.url !== file.url))
                }
              >
                <IconX className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {popover}
    </div>
  );
}

function useUploadFile(formId: string | null | undefined, questionId: string) {
  const mutation = useActionMutation("upload-form-file");
  const send = mutation.mutateAsync;
  if (!formId) return undefined;
  return async (file: Blob, filename: string) => {
    const password = passwordFor(formId);
    const { url } = await send({
      formId,
      questionId,
      sessionId: sessionIdFor(formId),
      ...(password === undefined ? {} : { password }),
      filename,
      contentType: file.type || "application/octet-stream",
      data: await toBase64(file),
    });
    return url;
  };
}

export function FileField({
  question,
  value,
  onChange,
  invalid,
  formId,
}: FieldProps) {
  const t = useT();
  const send = useUploadFile(formId, question.id);
  return (
    <FilePicker
      settings={payloadOf({ question })}
      files={storedFiles(value)}
      invalid={invalid}
      describedBy={invalid ? `error_${question.id}` : undefined}
      label={t("forms.richBlocks.chooseFile")}
      formId={formId}
      upload={send && ((file) => send(file, file.name))}
      onChange={(files) =>
        onChange(
          files.length
            ? {
                files: files.map((file) => file.url),
                names: files.map((file) => file.name),
              }
            : null,
        )
      }
    />
  );
}

const CANVAS_W = 800;
const CANVAS_H = 300;

/** A drawing canvas. `onDrawn` receives the PNG when a stroke ends; absent in the editor. */
export function SignaturePad({
  signedUrl,
  invalid,
  describedBy,
  label,
  formId,
  readOnly = false,
  onDrawn,
  onClear,
}: {
  signedUrl: string | null;
  /** The editor shows the canvas without taking strokes. */
  readOnly?: boolean;
  invalid: boolean;
  describedBy?: string | undefined;
  label: string;
  formId?: string | null | undefined;
  onDrawn?: ((png: Blob) => Promise<void>) | undefined;
  onClear: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const { anchor, gate, popover } = useUploadGate(formId);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = signedUrl ? safeMediaUrl(signedUrl) : null;

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * CANVAS_W,
      y: ((event.clientY - box.top) / box.height) * CANVAS_H,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (busy) return;
    const target = event.currentTarget;
    const { pointerId } = event;
    const at = point(event);
    gate(() => {
      const context = target.getContext("2d");
      if (!context) return;
      target.setPointerCapture(pointerId);
      drawing.current = true;
      context.lineWidth = 4;
      context.lineCap = "round";
      context.strokeStyle = "black";
      context.beginPath();
      context.moveTo(at.x, at.y);
    });
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    const at = point(event);
    context?.lineTo(at.x, at.y);
    context?.stroke();
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    setDrawn(true);
    if (!onDrawn) return;
    event.currentTarget.toBlob((png) => {
      if (!png) return;
      setBusy(true);
      void onDrawn(png)
        .catch(() =>
          sonnerToast.error(t("forms.richBlocks.respond.uploadFailed")),
        )
        .finally(() => setBusy(false));
    }, "image/png");
  }

  function clear() {
    const context = canvas.current?.getContext("2d");
    context?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setDrawn(false);
    onClear();
  }

  return (
    <div ref={anchor} className="flex flex-col items-start gap-2">
      <div
        className={cn(
          "forms-input relative h-[150px] w-[400px] max-w-full overflow-hidden",
          FIELD_SURFACE,
          invalid && "ring-1 ring-destructive",
        )}
      >
        <canvas
          ref={canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          aria-label={label}
          aria-describedby={describedBy}
          className="size-full cursor-crosshair touch-none"
          onPointerDown={readOnly ? undefined : start}
          onPointerMove={readOnly ? undefined : move}
          onPointerUp={readOnly ? undefined : end}
          onPointerCancel={readOnly ? undefined : end}
        />
        {url && !drawn ? (
          <img
            src={url}
            alt=""
            className="pointer-events-none absolute inset-0 size-full bg-background object-contain"
          />
        ) : null}
        {busy ? (
          <IconLoader2 className="absolute top-2 right-2 size-4 animate-spin" />
        ) : null}
      </div>
      <div className="flex w-[400px] max-w-full items-center justify-between text-sm text-muted-foreground">
        <span>{t("forms.richBlocks.respond.signatureLabel")}</span>
        {signedUrl || drawn ? (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-muted"
            onClick={clear}
          >
            {t("forms.richBlocks.respond.clearSignature")}
          </button>
        ) : null}
      </div>
      {popover}
    </div>
  );
}

export function SignatureField({
  question,
  value,
  onChange,
  invalid,
  formId,
}: FieldProps) {
  const t = useT();
  const send = useUploadFile(formId, question.id);
  return (
    <SignaturePad
      signedUrl={typeof value === "string" && value ? value : null}
      invalid={invalid}
      describedBy={invalid ? `error_${question.id}` : undefined}
      label={t("forms.richBlocks.respond.signatureCanvas")}
      formId={formId}
      onDrawn={
        send && (async (png) => onChange(await send(png, "signature.png")))
      }
      onClear={() => onChange(null)}
    />
  );
}
