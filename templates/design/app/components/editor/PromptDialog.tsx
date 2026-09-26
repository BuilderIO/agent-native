import { trackEvent } from "@agent-native/core/client/analytics";
import { appBasePath } from "@agent-native/core/client/api-path";
import {
  type AgentChatContextItem,
  type ComposerContextMenuItem,
  type ComposerContextSnapshot,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
  useEagerFileUploads,
} from "@agent-native/core/client/composer";
import { useT } from "@agent-native/core/client/i18n";
import { LazyChunkErrorBoundary } from "@agent-native/core/client/lazy-chunk-error-boundary";
import { LazyChunkRetryFallback } from "@agent-native/core/client/lazy-chunk-retry-fallback";
import { useOrg } from "@agent-native/core/client/org";
import {
  IconApps,
  IconArtboard,
  IconBrain,
  IconPalette,
  IconPlus,
  IconSparkles,
} from "@tabler/icons-react";
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";

import {
  DesignSystemPickerControl,
  TemplatePickerControl,
  type PromptDesignSystemOption,
  type PromptTemplateOption,
} from "@/components/editor/design-start-pickers";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";

export type {
  PromptDesignSystemOption,
  PromptTemplateOption,
} from "@/components/editor/design-start-pickers";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createDesignPromptAttachmentAdapter } from "@/lib/prompt-attachment-adapter";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

const loadPromptComposer = () =>
  import("@agent-native/core/client/composer").then(({ PromptComposer }) => ({
    default: PromptComposer,
  }));
const LazyPromptComposer = lazy(loadPromptComposer);
export function preloadPromptComposer() {
  void loadPromptComposer().catch(() => {});
}

export interface UploadedFile {
  path: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
  textContent?: string;
  textTruncated?: boolean;
  dataUrl?: string;
}

const RAW_CHAT_IMAGE_ATTACHMENT_BYTES = 512 * 1024;
const MAX_TOTAL_CHAT_IMAGE_DATA_URL_BYTES = 3_000_000;
const DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES = 1_250_000;
const CHAT_IMAGE_ATTACHMENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const IMAGE_COMPRESSION_PASSES = [
  { maxDimension: 1400, jpegQuality: 0.76 },
  { maxDimension: 1024, jpegQuality: 0.7 },
  { maxDimension: 768, jpegQuality: 0.65 },
];

function dataUrlBytes(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).byteLength;
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = url;
  });
}

async function compressImageAttachment(
  file: File,
  maxDimension: number,
  jpegQuality: number,
): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const ratio = Math.min(
      maxDimension / image.naturalWidth,
      maxDimension / image.naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", jpegQuality);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function readChatImageAttachment(
  file: File,
  maxDataUrlBytes = DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES,
): Promise<string | null> {
  if (!CHAT_IMAGE_ATTACHMENT_TYPES.has(file.type.toLowerCase())) return null;

  if (file.size <= RAW_CHAT_IMAGE_ATTACHMENT_BYTES) {
    const raw = await readFileDataUrl(file);
    if (raw && dataUrlBytes(raw) <= maxDataUrlBytes) return raw;
  }

  let fallback: string | null = null;
  for (const pass of IMAGE_COMPRESSION_PASSES) {
    const compressed = await compressImageAttachment(
      file,
      pass.maxDimension,
      pass.jpegQuality,
    );
    if (!compressed) continue;
    fallback = compressed;
    if (dataUrlBytes(compressed) <= maxDataUrlBytes) {
      return compressed;
    }
  }
  return fallback && dataUrlBytes(fallback) <= maxDataUrlBytes
    ? fallback
    : null;
}

export type PromptCreationMode = "design" | "app";

interface PromptPopoverProps {
  inline?: boolean;
  submissionIdentity?: string;
  contextItems?: AgentChatContextItem[];
  contextMenuItems?: ComposerContextMenuItem[];
  onRemoveContextItem?: (key: string) => void;
  onRetryContextItem?: (key: string) => void;
  onSubmitError?: () => void;
  beforeSubmitContext?: (
    snapshot: ComposerContextSnapshot | undefined,
  ) => Promise<ComposerContextSnapshot | undefined>;
  composerRef?: React.Ref<TiptapComposerHandle>;
  initialText?: string;
  initialTextKey?: number;
  disabled?: boolean;
  submissionDisabled?: boolean;
  showModelSelector?: boolean;
  modelStatusChecksEnabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder?: string;
  /** Return false when the caller navigates and the popover must not issue a
   * competing close-state navigation after the handoff completes. */
  onSkip?: () => void | boolean | Promise<void | boolean>;
  skipLabel?: string;
  /** Open on a two-way choice — blank canvas or AI — instead of dropping the
   *  user straight into a prompt with the blank path hidden in a corner link. */
  offerStartChoice?: boolean;
  onSubmit: (
    prompt: string,
    files: UploadedFile[],
    options: PromptComposerSubmitOptions,
  ) => void | Promise<void>;
  loading?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  designSystems?: PromptDesignSystemOption[];
  designSystemsLoading?: boolean;
  selectedDesignSystemId?: string | null;
  onDesignSystemChange?: (id: string | null) => void;
  onCreateDesignSystem?: () => void;
  creativeContexts?: PromptCreativeContextOption[];
  creativeContextsLoading?: boolean;
  selectedCreativeContextId?: string | null;
  onCreativeContextChange?: (id: string | null) => void;
  templateOptions?: PromptTemplateOption[];
  templatesLoading?: boolean;
  selectedTemplateId?: string | null;
  onTemplateChange?: (id: string | null) => void;
  /**
   * "Design" (inline prototype, default) vs "Full app" (Builder Fusion cloud
   * container). Omit both this and `onCreationModeChange` to hide the mode
   * selector entirely — used when full-app building is flag-disabled, so the
   * popover renders pixel-identical to the design-only version.
   */
  creationMode?: PromptCreationMode;
  onCreationModeChange?: (mode: PromptCreationMode) => void;
  /**
   * Scopes the composer's localStorage draft key so an abandoned draft in
   * this popover never bleeds into a different popover instance (e.g. the
   * "generate design" and "tweak" popovers both mount unscoped composers
   * that would otherwise share the same global draft key). Defaults to a
   * scope derived from `title`, which is already distinct across the
   * current call sites; pass an explicit value (e.g. including a design id)
   * for finer isolation between instances that share the same title. The
   * popover further suffixes whatever scope it resolves with the active
   * org id (see `PromptPopover`'s `orgScopedDraftScope`), so an abandoned
   * draft never survives switching accounts either — callers never need to
   * fold the org id in themselves.
   */
  draftScope?: string;
  /** Keep organization lookups out of unauthenticated prompt hosts. */
  scopeDraftsToOrg?: boolean;
}

export interface PromptCreativeContextOption {
  id: string;
  name: string;
}

function isNestedPromptPopoverTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-agent-native-composer-popover],[data-agent-native-prompt-select],[data-agent-native-template-popover]",
      ),
    )
  );
}

// While a nested Radix Select/Popover/Dropdown is open, Radix locks
// `pointer-events` on everything outside its own portalled content so only
// that content (and its trigger) remain interactive. That lockout is what
// lets the interaction happen at all, but it also means the pointer/focus
// event that reaches our `onInteractOutside` handler resolves its `target`
// to `<html>`/`document` instead of the element the user actually clicked —
// the real target sits under a `pointer-events: none` ancestor, so the
// browser reports the outermost still-hit-testable node. That target fails
// any `closest()` containment check, so the click looks "outside" the
// dialog and dismisses it even though the user never left the popover.
//
// Rather than pattern-match on the resolved (and unreliable) target, check
// whether any of our nested portalled surfaces are currently open in the
// DOM — they're stamped with the same data attributes whether or not the
// interact-outside target correctly resolved into them. If one is open,
// this is never a genuine outside click.
function hasOpenNestedPromptPopoverSurface() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[data-agent-native-composer-popover][data-state="open"],' +
        '[data-agent-native-prompt-select][data-state="open"],' +
        '[data-agent-native-template-popover][data-state="open"]',
    ),
  );
}

export default function PromptPopover({
  inline = false,
  submissionIdentity,
  contextItems,
  contextMenuItems,
  onRemoveContextItem,
  onRetryContextItem,
  onSubmitError,
  beforeSubmitContext,
  composerRef,
  initialText,
  initialTextKey,
  disabled = false,
  submissionDisabled = false,
  showModelSelector,
  modelStatusChecksEnabled,
  open,
  onOpenChange: onPopoverOpenChange,
  title,
  placeholder,
  onSkip,
  skipLabel,
  offerStartChoice = false,
  onSubmit,
  loading = false,
  anchorRef,
  centered = false,
  designSystems = [],
  designSystemsLoading = false,
  selectedDesignSystemId,
  onDesignSystemChange,
  onCreateDesignSystem,
  creativeContexts = [],
  creativeContextsLoading = false,
  selectedCreativeContextId,
  onCreativeContextChange,
  templateOptions = [],
  templatesLoading = false,
  selectedTemplateId,
  onTemplateChange,
  creationMode,
  onCreationModeChange,
  draftScope,
  scopeDraftsToOrg = true,
}: PromptPopoverProps) {
  const t = useT();
  const systemsEnabled = useDesignSystemWorkflows();
  const attachmentLimitMessage = t("promptDialog.attachmentsTooLarge", {
    max: MAX_UPLOAD_MB,
  });
  const attachmentAdapter = useMemo(
    () => createDesignPromptAttachmentAdapter(attachmentLimitMessage),
    [attachmentLimitMessage],
  );
  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!inline) onPopoverOpenChange(nextOpen);
    },
    [inline, onPopoverOpenChange],
  );
  // Composer drafts persist to localStorage, which is scoped to the browser
  // origin, not to the signed-in account — switching orgs is a client-side
  // transition with no reload and no storage clear (see useSwitchOrg). Fold
  // the active org id into the key so a draft abandoned under one account
  // never resurfaces after switching to another.
  const { data: org, isPending: orgPending } = useOrg({
    enabled: scopeDraftsToOrg,
  });
  const baseDraftScope = draftScope ?? title;
  // Before the org query resolves, we don't yet know which account this
  // draft belongs to. Route to a distinct "pending" bucket rather than
  // falling back to the unscoped base key, which could otherwise restore
  // (or later leak) a different account's abandoned draft during the brief
  // window before `org` loads. `org?.orgId` is legitimately `null` for
  // users with no active org, so that gets its own stable suffix too.
  const orgScopedDraftScope = scopeDraftsToOrg
    ? orgPending
      ? `${baseDraftScope}:pending`
      : `${baseDraftScope}:${org?.orgId ?? "none"}`
    : `${baseDraftScope}:anonymous`;
  const recoveryScope = `${orgScopedDraftScope}:${submissionIdentity ?? ""}`;
  const draftScopeRef = useRef(recoveryScope);
  draftScopeRef.current = recoveryScope;
  const [showStartChoice, setShowStartChoice] = useState(offerStartChoice);
  const [skipInFlight, setSkipInFlight] = useState(false);
  const skipInFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const draftTextRef = useRef<string | undefined>(undefined);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // A failed popover handoff can remount the composer. Leave its normal
  // localStorage restoration untouched unless that handoff needs recovery;
  // a defined initialText (even "") would short-circuit draft restoration.
  const [restoredPrompt, setRestoredPrompt] = useState<{
    text: string;
    initialTextKey: number | undefined;
    revision: number;
    draftScope: string;
  }>();
  const restorePromptText = useCallback(
    (text: string) => {
      setRestoredPrompt((current) => ({
        text,
        initialTextKey,
        draftScope: recoveryScope,
        revision: (current?.revision ?? 0) + 1,
      }));
    },
    [initialTextKey, recoveryScope],
  );
  // A new starter must not consume its seed key with the previous failed text.
  const activeRestoredPrompt =
    restoredPrompt?.initialTextKey === initialTextKey &&
    restoredPrompt?.draftScope === recoveryScope
      ? restoredPrompt
      : undefined;
  useEffect(() => {
    if (open) return;
    // A submit closes the popover immediately and may still fail, which
    // reopens it to restore the typed prompt. Resetting to the start choice
    // here would hide that restored composer behind the two cards.
    if (submittingRef.current) return;
    setShowStartChoice(offerStartChoice);
    skipInFlightRef.current = false;
    setSkipInFlight(false);
  }, [open]);
  // While the nested design-system Select is open, Radix disables pointer
  // events on everything else and the click that closes the Select also
  // moves focus back to its trigger. That focus-return is itself reported to
  // the popover's dismissable layer as a "focus outside" interaction — and it
  // fires *after* the Select has already unmounted its portalled content, so
  // by then there is nothing left in the DOM for `onInteractOutside` to
  // recognize as "still nested and open". Latch a short-lived flag the
  // instant the Select reports closing, and have the popover's
  // interact-outside guard also honor that flag so the popover survives the
  // Select's own close-triggered focus shuffle. See PromptDialog R87/R91.
  const justClosedNestedSelectRef = useRef(false);
  const clearJustClosedNestedSelectTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const markNestedSelectJustClosed = useCallback(() => {
    justClosedNestedSelectRef.current = true;
    if (clearJustClosedNestedSelectTimeoutRef.current != null) {
      clearTimeout(clearJustClosedNestedSelectTimeoutRef.current);
    }
    clearJustClosedNestedSelectTimeoutRef.current = setTimeout(() => {
      justClosedNestedSelectRef.current = false;
      clearJustClosedNestedSelectTimeoutRef.current = null;
    }, 300);
  }, []);
  useEffect(
    () => () => {
      if (clearJustClosedNestedSelectTimeoutRef.current != null) {
        clearTimeout(clearJustClosedNestedSelectTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) return;
    setTemplatePickerOpen(false);
    // Same reason as above: a still-running submit owns these until it either
    // commits them or fails and hands the composer back with its attachments.
    if (submittingRef.current) return;
    // Only sticks for the session immediately following a failed submit; a
    // fresh open after a real close should fall back to the composer's own
    // localStorage draft restore for this scope, not a stale failed prompt.
    setRestoredPrompt(undefined);
  }, [open]);

  const uploadFilesToServer = useCallback(
    async (files: File[]): Promise<UploadedFile[]> => {
      if (files.length === 0) return [];
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_UPLOAD_BYTES) {
        throw new Error(
          t("promptDialog.attachmentsTooLarge", { max: MAX_UPLOAD_MB }),
        );
      }
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      const res = await fetch(`${appBasePath()}/api/uploads`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        // coercion-ok: error responses may be non-JSON; the HTTP status is still thrown below.
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Upload failed (${res.status})`,
        );
      }
      const uploaded = (await res.json()) as UploadedFile[];
      const imageFileCount =
        files.filter((file) =>
          CHAT_IMAGE_ATTACHMENT_TYPES.has(file.type.toLowerCase()),
        ).length || 1;
      const maxImageDataUrlBytes = Math.min(
        DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES,
        Math.floor(MAX_TOTAL_CHAT_IMAGE_DATA_URL_BYTES / imageFileCount),
      );
      const visualAttachments = await Promise.all(
        files.map((file) =>
          readChatImageAttachment(file, maxImageDataUrlBytes),
        ),
      );
      return uploaded.map((file, index) =>
        visualAttachments[index]
          ? { ...file, dataUrl: visualAttachments[index] }
          : file,
      );
    },
    [t],
  );
  const deleteUploadedFile = useCallback(async (file: UploadedFile) => {
    const response = await fetch(`${appBasePath()}/api/uploads`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ path: file.path }),
    });
    if (!response.ok) {
      throw new Error(`Upload cleanup failed (${response.status})`);
    }
  }, []);
  const handleRetainedFilesAbandoned = useCallback(
    (_files: readonly File[], discard: () => void) => {
      if (!submittingRef.current) discard();
    },
    [],
  );
  const {
    commitFiles,
    discardFiles,
    retainFiles,
    syncFiles,
    uploadFiles,
    uploading,
    reset: resetEagerUploads,
  } = useEagerFileUploads(uploadFilesToServer, {
    onDiscard: deleteUploadedFile,
    onRetainedFilesAbandoned: handleRetainedFilesAbandoned,
  });

  useEffect(() => {
    if (!open) {
      if (!submitting) {
        setSubmitting(false);
        resetEagerUploads();
      }
    }
  }, [open, resetEagerUploads, submitting]);

  const handleAttachmentsChange = useCallback(
    (files: File[]) => {
      syncFiles(files);
      void uploadFiles(files).catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : t("promptDialog.failedToUploadFile"),
        );
      });
    },
    [syncFiles, t, uploadFiles],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      files: File[],
      _references: unknown,
      options: PromptComposerSubmitOptions,
    ) => {
      if (submittingRef.current) return;
      const recoveryText = inline ? (draftTextRef.current ?? text) : text;
      const submissionScope = recoveryScope;
      submittingRef.current = true;
      setSubmitting(true);
      // The work continues in the caller and the editor shows its own loading
      // state, so holding the popover open until the round trip finishes just
      // leaves a dead panel over the result. Reopened below if it fails.
      onOpenChange(false);
      let uploaded: UploadedFile[];
      let submissionOptions = options;
      try {
        if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES)
          throw new Error(attachmentLimitMessage);
        if (beforeSubmitContext)
          submissionOptions = {
            ...options,
            contextItems: await beforeSubmitContext(options.contextItems),
          };
        uploaded = await uploadFiles(files);
        if (draftScopeRef.current !== submissionScope)
          throw new Error(t("promptDialog.failedToSubmitPrompt"));
      } catch (error) {
        setSubmitting(false);
        submittingRef.current = false;
        onOpenChange(true);
        if (draftScopeRef.current === submissionScope)
          restorePromptText(recoveryText);
        onSubmitError?.();
        toast.error(
          error instanceof Error
            ? error.message
            : t("promptDialog.failedToUploadFile"),
        );
        throw error;
      }
      try {
        retainFiles(files);
        await onSubmit(text, uploaded, submissionOptions);
        commitFiles(files);
        setSubmitting(false);
        submittingRef.current = false;
      } catch (error) {
        discardFiles(files);
        setSubmitting(false);
        submittingRef.current = false;
        onOpenChange(true);
        if (draftScopeRef.current === submissionScope)
          restorePromptText(recoveryText);
        onSubmitError?.();
        toast.error(
          error instanceof Error
            ? error.message
            : t("promptDialog.failedToSubmitPrompt"),
        );
        throw error;
      }
    },
    [
      commitFiles,
      discardFiles,
      onOpenChange,
      onSubmit,
      onSubmitError,
      beforeSubmitContext,
      attachmentLimitMessage,
      recoveryScope,
      inline,
      retainFiles,
      restorePromptText,
      t,
      uploadFiles,
    ],
  );

  const hasLiveVirtualAnchor = !centered && Boolean(anchorRef?.current);
  // Radix keeps the closed popover mounted while the exit animation plays, but
  // callers may clear `anchorRef` as soon as they close it. Latch the anchor
  // mode from the last open render so the closing popover never swaps over to
  // the static fallback anchor mid-exit (which re-anchored the fading popover
  // to the top-left corner of the screen).
  const anchorModeWhileOpenRef = useRef(hasLiveVirtualAnchor);
  if (open) {
    anchorModeWhileOpenRef.current = hasLiveVirtualAnchor;
  }
  const hasVirtualAnchor = open
    ? hasLiveVirtualAnchor
    : anchorModeWhileOpenRef.current;

  // Stable virtual anchor that measures the live anchor element while it is
  // attached and falls back to the last good rect afterwards. The anchor
  // element can unmount on unrelated sidebar re-renders, and the ref can be
  // cleared during the exit animation; measuring a detached element returns a
  // zero rect, which used to reposition the popover to the viewport origin.
  const latestAnchorRef = useRef(anchorRef);
  latestAnchorRef.current = anchorRef;
  const lastAnchorRectRef = useRef<DOMRect | null>(null);
  const [virtualAnchorRef] = useState<
    React.RefObject<{ getBoundingClientRect: () => DOMRect }>
  >(() => ({
    current: {
      getBoundingClientRect: () => {
        const el = latestAnchorRef.current?.current;
        if (el?.isConnected) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            lastAnchorRectRef.current = rect;
            return rect;
          }
        }
        return (
          lastAnchorRectRef.current ??
          new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
        );
      },
    },
  }));
  const selectedCreativeContext =
    creativeContexts.find(
      (context) => context.id === selectedCreativeContextId,
    ) ?? null;
  const showCreativeContextPicker =
    Boolean(onCreativeContextChange) &&
    (creativeContextsLoading || creativeContexts.length > 0);

  const content = (
    <>
      {(!inline || creationMode) && (
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
          {!inline && (
            <span className="text-sm font-medium text-foreground/90">
              {title}
            </span>
          )}
          {creationMode && onCreationModeChange ? (
            <CreationModeToggle
              mode={creationMode}
              onChange={onCreationModeChange}
              disabled={loading || uploading || submitting}
            />
          ) : null}
        </div>
      )}

      {showStartChoice ? (
        <div className="grid grid-cols-2 gap-2 px-3.5 pt-1 pb-3.5">
          <button
            type="button"
            data-start-with-ai
            disabled={loading}
            onClick={() => {
              trackEvent("design_start_mode_selected", {
                app_name: "design",
                template_name: "design",
                mode: "ai",
              });
              setShowStartChoice(false);
              // autoFocus already ran while the composer was display:none,
              // so revealing it leaves no caret. Focus it once it is shown.
              requestAnimationFrame(() => {
                const composer = document.querySelector<HTMLElement>(
                  "[data-agent-native-prompt-popover] .ProseMirror",
                );
                composer?.focus();
              });
            }}
            className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-transparent bg-[var(--design-editor-accent-color)] px-3 py-3 text-left text-[color:var(--design-editor-accent-contrast-color)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconSparkles className="size-5 shrink-0" />
            <span className="text-sm font-medium">
              {t("promptDialog.startWithAi")}
            </span>
            <span className="text-xs leading-snug opacity-80">
              {t("promptDialog.startWithAiHint")}
            </span>
          </button>
          <button
            type="button"
            data-start-blank-canvas
            disabled={loading || skipInFlight}
            onClick={() => {
              if (loading || skipInFlightRef.current) return;
              trackEvent("design_start_mode_selected", {
                app_name: "design",
                template_name: "design",
                mode: "blank_canvas",
              });
              skipInFlightRef.current = true;
              setSkipInFlight(true);
              // Close on commit rather than after the design is created and
              // navigated to — the editor owns the loading state from here.
              onOpenChange(false);
              void (async () => {
                try {
                  await onSkip?.();
                } catch {
                  skipInFlightRef.current = false;
                  setSkipInFlight(false);
                  onOpenChange(true);
                }
              })();
            }}
            className="flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconArtboard className="size-5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {t("promptDialog.startBlankCanvas")}
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              {t("promptDialog.startBlankCanvasHint")}
            </span>
          </button>
        </div>
      ) : null}

      <div className={cn(!inline && "px-2 pb-2", showStartChoice && "hidden")}>
        <LazyChunkErrorBoundary fallback={<LazyChunkRetryFallback />}>
          <Suspense
            fallback={
              <div
                aria-busy="true"
                className="flex min-h-36 flex-col justify-between gap-3 rounded-md border border-input p-3"
              >
                <Skeleton className="h-16 w-full" />
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="size-8" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            }
          >
            <LazyPromptComposer
              key={
                inline
                  ? orgScopedDraftScope
                  : (placeholder ?? t("home.describeBuild"))
              }
              autoFocus
              attachmentsEnabled
              attachmentAdapter={attachmentAdapter}
              inlineTextAttachments={false}
              maxDocumentAttachmentBytes={MAX_UPLOAD_BYTES}
              disabled={disabled || loading || submitting}
              submissionDisabled={submissionDisabled}
              layoutVariant={inline ? "hero" : undefined}
              className={
                inline ? "design-home-prompt-composer-area" : undefined
              }
              composerRef={composerRef}
              ariaLabel={placeholder ?? t("home.describeBuild")}
              showModelSelector={showModelSelector}
              modelStatusChecksEnabled={modelStatusChecksEnabled}
              placeholder={placeholder ?? t("home.describeBuild")}
              onSubmit={handleSubmit}
              onTextChange={(text) => {
                draftTextRef.current = text;
              }}
              contextItems={contextItems}
              onRemoveContextItem={onRemoveContextItem}
              onRetryContextItem={onRetryContextItem}
              onAttachmentsChange={handleAttachmentsChange}
              draftScope={orgScopedDraftScope}
              initialText={activeRestoredPrompt?.text ?? initialText}
              initialTextKey={
                activeRestoredPrompt
                  ? `restore:${initialTextKey ?? 0}:${activeRestoredPrompt.revision}`
                  : `seed:${initialTextKey ?? 0}`
              }
              contextMenuItems={contextMenuItems ?? []}
            />
          </Suspense>
        </LazyChunkErrorBoundary>
      </div>
      {!inline &&
        !showStartChoice &&
        (onTemplateChange ||
          (systemsEnabled &&
            (onDesignSystemChange || onCreateDesignSystem))) && (
          <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2 border-t border-border px-3.5 py-2.5">
            {onTemplateChange ? (
              <>
                <TemplatePickerControl
                  open={templatePickerOpen}
                  onOpenChange={setTemplatePickerOpen}
                  options={templateOptions}
                  loading={templatesLoading}
                  selectedId={selectedTemplateId ?? null}
                  onChange={onTemplateChange}
                />
                <span aria-hidden="true" className="size-9" />
              </>
            ) : null}
            {systemsEnabled &&
            (onDesignSystemChange || onCreateDesignSystem) ? (
              <>
                <DesignSystemPickerControl
                  designSystems={designSystems}
                  loading={designSystemsLoading}
                  selectedId={selectedDesignSystemId ?? null}
                  onChange={(id) => onDesignSystemChange?.(id)}
                  onSelectClosed={markNestedSelectJustClosed}
                />
                {onCreateDesignSystem ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => {
                          trackEvent("design_system_creator_opened", {
                            app_name: "design",
                            template_name: "design",
                          });
                          onCreateDesignSystem();
                        }}
                        aria-label={t("promptDialog.createDesignSystem")}
                      >
                        <IconPlus className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("promptDialog.createDesignSystem")}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span aria-hidden="true" className="size-9" />
                )}
              </>
            ) : null}
            {showCreativeContextPicker ? (
              <>
                {creativeContextsLoading ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : (
                  <Select
                    value={selectedCreativeContextId ?? "none"}
                    onValueChange={(value) =>
                      onCreativeContextChange?.(value === "none" ? null : value)
                    }
                    onOpenChange={(nextOpen) => {
                      if (!nextOpen) markNestedSelectJustClosed();
                    }}
                  >
                    <SelectTrigger className="min-w-0 justify-start gap-2 px-2.5 text-xs [&>svg:last-child]:ms-auto">
                      <IconBrain className="size-4 shrink-0 text-muted-foreground" />
                      <span
                        className="min-w-0 flex-1 truncate text-start"
                        title={
                          selectedCreativeContext?.name ??
                          t("creativeContext.automatic")
                        }
                      >
                        {selectedCreativeContext?.name ??
                          t("creativeContext.automatic")}
                      </span>
                    </SelectTrigger>
                    <SelectContent data-agent-native-prompt-select>
                      <SelectItem value="none" className="text-xs">
                        {t("creativeContext.automatic")}
                      </SelectItem>
                      {creativeContexts.map((context) => (
                        <SelectItem
                          key={context.id}
                          value={context.id}
                          className="text-xs"
                        >
                          {context.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span aria-hidden="true" className="size-9" />
              </>
            ) : null}
          </div>
        )}

      {/* The chooser already offers the blank path as a peer, so the corner
            link would be a second, quieter way to do the same thing. */}
      {onSkip && skipLabel && !inline && !offerStartChoice && (
        <div className="flex justify-end border-t border-border px-3.5 py-2">
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={loading || skipInFlight}
            onClick={() => {
              if (loading || skipInFlightRef.current) return;
              skipInFlightRef.current = true;
              setSkipInFlight(true);
              void (async () => {
                try {
                  const shouldClose = await onSkip();
                  if (shouldClose !== false) onOpenChange(false);
                } catch {
                  // The caller owns error presentation. Keep the prompt open
                  // and usable so the user can retry or submit a prompt.
                  skipInFlightRef.current = false;
                  setSkipInFlight(false);
                }
              })();
            }}
          >
            {skipLabel}
          </Button>
        </div>
      )}
    </>
  );

  if (inline) return <div data-design-inline-prompt>{content}</div>;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {open && centered && (
        <div
          className="fixed inset-0 z-[199] bg-black/40"
          onClick={() => onOpenChange(false)}
        />
      )}
      {hasVirtualAnchor ? (
        <PopoverAnchor virtualRef={virtualAnchorRef} />
      ) : (
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className={
              centered
                ? "fixed left-1/2 top-1/2 size-px"
                : "fixed left-3 top-3 size-px"
            }
          />
        </PopoverAnchor>
      )}
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={12}
        collisionPadding={12}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (
            isNestedPromptPopoverTarget(event.target) ||
            hasOpenNestedPromptPopoverSurface() ||
            justClosedNestedSelectRef.current
          ) {
            event.preventDefault();
          }
        }}
        data-agent-native-prompt-popover
        className="relative z-[200] w-[min(420px,calc(100vw-24px))] rounded-xl border-border p-0 shadow-2xl shadow-black/60"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact segmented "Design" / "Full app" pill selector shown in the new-design
 * popover title row. Only rendered by the caller when full-app building is
 * flag-enabled by the Design page — when
 * absent the popover renders with no mode control at all.
 */
function CreationModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "design" | "app";
  onChange: (mode: "design" | "app") => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={
        "Design or full app" /* i18n-ignore compact new-design mode toggle, flag-gated */
      }
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "design"}
        disabled={disabled}
        onClick={() => {
          trackEvent("design_start_mode_selected", {
            app_name: "design",
            template_name: "design",
            mode: "design",
          });
          onChange("design");
        }}
        className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 !text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          mode === "design"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground/80"
        }`}
      >
        <IconPalette className="h-3 w-3" />
        {"Design" /* i18n-ignore compact new-design mode toggle, flag-gated */}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "app"}
        disabled={disabled}
        onClick={() => {
          trackEvent("design_start_mode_selected", {
            app_name: "design",
            template_name: "design",
            mode: "app",
          });
          onChange("app");
        }}
        className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 !text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          mode === "app"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground/80"
        }`}
      >
        <IconApps className="h-3 w-3" />
        {
          "Full app" /* i18n-ignore compact new-design mode toggle, flag-gated */
        }
      </button>
    </div>
  );
}
