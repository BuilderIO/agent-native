import { useComposerRuntime } from "@assistant-ui/react";
import {
  IconPlus,
  IconUpload,
  IconBulb,
  IconClock,
  IconBolt,
  IconTool,
  IconPlugConnected,
  IconPhotoPlus,
  IconLoader2,
  IconArrowLeft,
  IconX,
} from "@tabler/icons-react";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";

import { setAgentChatContextItem } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { isMcpIntegrationCatalogAvailable } from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import {
  useCreateMcpServer,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";
import { cn } from "../utils.js";
import type { ComposerMode } from "./types.js";

interface ComposerPlusMenuProps {
  onSelectMode?: (mode: ComposerMode) => void;
  onAttachmentError?: (message: string) => void;
  /**
   * "full" (default): full + menu with Upload File, Create Skill, Schedule Task,
   * Automation, Extension, MCP Server. "upload-only": clicking + opens the file
   * picker directly — no popover, no other modes. Use for prompt popovers
   * (create extension, create deck, create dashboard, etc.) where the only thing
   * to attach is a file.
   */
  mode?: "full" | "upload-only";
}

type View = "menu" | "skill-upload";

const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";
const EMBED_PROTOCOL = "agent-native.embed";
const EMBED_VERSION = 1;

interface EmbedEnvelope<TPayload = unknown> {
  protocol?: string;
  version?: number;
  type?: string;
  name?: string;
  payload?: TPayload;
}

interface AssetPickerPayload {
  assetId?: unknown;
  url?: unknown;
  previewUrl?: unknown;
  downloadUrl?: unknown;
  embedUrl?: unknown;
  altText?: unknown;
  title?: unknown;
  prompt?: unknown;
  mediaType?: unknown;
  libraryId?: unknown;
}

function assetPickerUrl() {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  return env.VITE_AGENT_NATIVE_ASSETS_PICKER_URL || DEFAULT_ASSETS_PICKER_URL;
}

function withEmbeddedParams(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("embedded", "1");
    parsed.searchParams.set("mediaType", "image");
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}embedded=1&mediaType=image`;
  }
}

function assetPickerOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
}

function embedEnvelope(
  type: "message" | "ready",
  options: { name?: string; payload?: unknown } = {},
): EmbedEnvelope {
  return {
    protocol: EMBED_PROTOCOL,
    version: EMBED_VERSION,
    type,
    ...options,
  };
}

function isEmbedEnvelope(value: unknown): value is EmbedEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as EmbedEnvelope;
  return (
    candidate.protocol === EMBED_PROTOCOL &&
    candidate.version === EMBED_VERSION &&
    typeof candidate.type === "string"
  );
}

function assetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assetImageSource(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const asset = payload as AssetPickerPayload;
  return (
    assetString(asset.url) ??
    assetString(asset.previewUrl) ??
    assetString(asset.downloadUrl) ??
    assetString(asset.embedUrl)
  );
}

function assetTitle(payload: unknown, url: string): string {
  if (payload && typeof payload === "object") {
    const title = assetString((payload as AssetPickerPayload).title);
    if (title) return title;
    const prompt = assetString((payload as AssetPickerPayload).prompt);
    if (prompt) return prompt.slice(0, 80);
  }
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "Generated image";
  } catch {
    return "Generated image";
  }
}

function assetContext(payload: unknown, url: string): string {
  const lines = [`Image URL: ${url}`];
  if (payload && typeof payload === "object") {
    const asset = payload as AssetPickerPayload;
    const assetId = assetString(asset.assetId);
    const libraryId = assetString(asset.libraryId);
    const prompt = assetString(asset.prompt);
    const altText = assetString(asset.altText);
    if (assetId) lines.push(`Asset ID: ${assetId}`);
    if (libraryId) lines.push(`Library ID: ${libraryId}`);
    if (prompt) lines.push(`Prompt: ${prompt}`);
    if (altText) lines.push(`Alt text: ${altText}`);
  }
  return lines.join("\n");
}

function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "uploaded-skill"
  );
}

function formatAttachmentError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function UploadOnlyAttachButton({
  onAttachmentError,
}: Pick<ComposerPlusMenuProps, "onAttachmentError">) {
  const composerRuntime = useComposerRuntime();
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await Promise.all(
        Array.from(files).map((file) => composerRuntime.addAttachment(file)),
      );
    } catch (error) {
      onAttachmentError?.(
        formatAttachmentError(error, "Could not upload the selected file."),
      );
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFilesSelected(event.target.files);
          event.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <button
              type="button"
              className="shrink-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
              aria-label="Upload"
              onClick={() => inputRef.current?.click()}
            >
              <IconPlus className="h-4 w-4" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Upload</TooltipContent>
      </Tooltip>
    </>
  );
}

export function ComposerPlusMenu({
  onSelectMode,
  onAttachmentError,
  mode = "full",
}: ComposerPlusMenuProps) {
  if (mode === "upload-only") {
    return <UploadOnlyAttachButton onAttachmentError={onAttachmentError} />;
  }
  return (
    <ComposerPlusMenuFull
      onSelectMode={onSelectMode}
      onAttachmentError={onAttachmentError}
    />
  );
}

function ComposerPlusMenuFull({
  onSelectMode,
  onAttachmentError,
}: Pick<ComposerPlusMenuProps, "onSelectMode" | "onAttachmentError">) {
  const t = useT();
  const composerRuntime = useComposerRuntime();
  const [open, setOpen] = useState(false);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const showMcpIntegrations = useMemo(
    () => isMcpIntegrationCatalogAvailable(),
    [],
  );

  const { data: org } = useOrg();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const hasOrg = !!org?.orgId;
  const defaultMcpScope: McpServerScope =
    hasOrg && canCreateOrgMcp ? "org" : "user";
  const createMcp = useCreateMcpServer();

  const fileUploadRef = useRef<HTMLInputElement>(null);
  const skillFileInputRef = useRef<HTMLInputElement>(null);
  const skillHoverTimerRef = useRef<number | null>(null);
  const [skillUploadSlug, setSkillUploadSlug] = useState("");
  const [skillUploadContent, setSkillUploadContent] = useState("");
  const [skillUploadFileName, setSkillUploadFileName] = useState("");
  const [skillUploadStatus, setSkillUploadStatus] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);
  const [skillUploadBusy, setSkillUploadBusy] = useState(false);
  const [skillFlyoutOpen, setSkillFlyoutOpen] = useState(false);
  const [skillFlyoutSide, setSkillFlyoutSide] = useState<"right" | "left">(
    "right",
  );
  const skillFlyoutCloseTimerRef = useRef<number | null>(null);
  const openSkillFlyout = (rowEl?: HTMLElement | null) => {
    if (skillFlyoutCloseTimerRef.current) {
      window.clearTimeout(skillFlyoutCloseTimerRef.current);
      skillFlyoutCloseTimerRef.current = null;
    }
    if (rowEl && typeof window !== "undefined") {
      const rect = rowEl.getBoundingClientRect();
      const FLYOUT_WIDTH = 248;
      setSkillFlyoutSide(
        window.innerWidth - rect.right < FLYOUT_WIDTH ? "left" : "right",
      );
    }
    setSkillFlyoutOpen(true);
  };
  const scheduleSkillFlyoutClose = () => {
    if (skillFlyoutCloseTimerRef.current)
      window.clearTimeout(skillFlyoutCloseTimerRef.current);
    skillFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setSkillFlyoutOpen(false);
    }, 160);
  };

  useEffect(() => {
    if (open) {
      setView("menu");
      setSkillUploadSlug("");
      setSkillUploadContent("");
      setSkillUploadFileName("");
      setSkillUploadStatus(null);
      setSkillUploadBusy(false);
      setSkillFlyoutOpen(false);
    }
  }, [open]);

  const handleSkillFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const text = await file.text();
    const baseName = file.name.replace(/\.[^./]+$/, "");
    const slug = slugifyName(
      baseName.toLowerCase() === "skill" ? "uploaded-skill" : baseName,
    );
    setSkillUploadSlug(slug);
    setSkillUploadContent(text);
    setSkillUploadFileName(file.name);
    setSkillUploadStatus(null);
    setView("skill-upload");
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await Promise.all(
        Array.from(files).map((file) => composerRuntime.addAttachment(file)),
      );
    } catch (error) {
      onAttachmentError?.(
        formatAttachmentError(error, "Could not upload the selected file."),
      );
    }
  };

  const submitSkillUpload = async () => {
    if (skillUploadBusy) return;
    const slug = slugifyName(skillUploadSlug || "uploaded-skill");
    const path = `skills/${slug}/SKILL.md`;
    setSkillUploadBusy(true);
    setSkillUploadStatus(null);
    try {
      const res = await fetch(agentNativePath("/_agent-native/resources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          content: skillUploadContent,
          mimeType: "text/markdown",
          shared: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `Upload failed (${res.status})`);
      }
      setSkillUploadStatus({
        kind: "ok",
        message: `Skill "${skillUploadFileName || `${slug}/SKILL.md`}" added`,
      });
      window.setTimeout(() => setOpen(false), 1200);
    } catch (err: any) {
      setSkillUploadStatus({
        kind: "err",
        message: err?.message || "Failed to save skill file",
      });
    } finally {
      setSkillUploadBusy(false);
    }
  };

  const menuItems: {
    icon: React.ReactNode;
    label: string;
    desc: string;
    action: () => void;
    hoverAction?: () => void;
  }[] = [
    {
      icon: <IconUpload className="h-3.5 w-3.5" />,
      label: "Upload File",
      desc: "Images, PDFs, text/code, JSON, CSV",
      action: () => {
        setOpen(false);
        setTimeout(() => fileUploadRef.current?.click(), 0);
      },
    },
    {
      icon: <IconPhotoPlus className="h-3.5 w-3.5" />,
      label: "Generate Image",
      desc: "Open the Assets image picker",
      action: () => {
        setOpen(false);
        setAssetsPickerOpen(true);
      },
    },
    {
      icon: <IconClock className="h-3.5 w-3.5" />,
      label: "Schedule Task",
      desc: "Run something on a schedule",
      action: () => {
        onSelectMode?.("job");
        setOpen(false);
      },
    },
    {
      icon: <IconBolt className="h-3.5 w-3.5" />,
      label: "Create Automation",
      desc: "Set up a when-X-do-Y rule",
      action: () => {
        onSelectMode?.("automation");
        setOpen(false);
      },
    },
    {
      icon: <IconTool className="h-3.5 w-3.5" />,
      label: "Create Extension",
      desc: "Build a mini app extension",
      action: () => {
        onSelectMode?.("extension");
        setOpen(false);
      },
    },
    ...(showMcpIntegrations
      ? [
          {
            icon: <IconPlugConnected className="h-3.5 w-3.5" />,
            label: t("mcpIntegrations.menuLabel"),
            desc: t("mcpIntegrations.menuDescription"),
            action: () => {
              setOpen(false);
              setMcpDialogOpen(true);
            },
          },
        ]
      : []),
    {
      icon: <IconBulb className="h-3.5 w-3.5" />,
      label: "Create Skill",
      desc: "Teach the agent a new ability",
      action: openSkillFlyout,
      hoverAction: openSkillFlyout,
    },
  ];

  return (
    <>
      {/* Hidden input to trigger the native file upload with explicit errors. */}
      <input
        ref={fileUploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFilesSelected(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={skillFileInputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={(e) => {
          void handleSkillFileSelected(e.target.files);
          e.target.value = "";
        }}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add...</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            "p-0 rounded-lg",
            view === "skill-upload"
              ? "max-h-[70vh] w-[calc(100vw-24px)] max-w-[380px] overflow-y-auto"
              : "w-[260px]",
          )}
          style={{ fontSize: 13, lineHeight: "normal" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {view === "menu" && (
            <div className="py-1">
              {menuItems.map((item) => {
                const isSkill = item.label === "Create Skill";
                return (
                  <div
                    key={item.label}
                    className={cn("relative", isSkill && "group/skill")}
                    onMouseEnter={(e) => {
                      if (isSkill) {
                        openSkillFlyout(e.currentTarget);
                        return;
                      }
                      if (!item.hoverAction) return;
                      if (skillHoverTimerRef.current)
                        window.clearTimeout(skillHoverTimerRef.current);
                      skillHoverTimerRef.current = window.setTimeout(() => {
                        item.hoverAction?.();
                      }, 180);
                    }}
                    onMouseLeave={() => {
                      if (isSkill) {
                        scheduleSkillFlyoutClose();
                        return;
                      }
                      if (skillHoverTimerRef.current) {
                        window.clearTimeout(skillHoverTimerRef.current);
                        skillHoverTimerRef.current = null;
                      }
                    }}
                  >
                    <button
                      type="button"
                      onClick={item.action}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-accent/50",
                        isSkill && skillFlyoutOpen && "bg-accent/50",
                      )}
                    >
                      <span className="text-muted-foreground">{item.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-foreground">
                          {item.label}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                          {item.desc}
                        </div>
                      </div>
                      {isSkill && (
                        <span className="ms-auto text-muted-foreground/60">
                          ›
                        </span>
                      )}
                    </button>
                    {isSkill && skillFlyoutOpen && (
                      <div
                        role="menu"
                        onMouseEnter={() => openSkillFlyout()}
                        onMouseLeave={scheduleSkillFlyoutClose}
                        className={cn(
                          "absolute top-0 z-20 w-[240px] rounded-lg border border-border bg-popover py-1 shadow-md",
                          skillFlyoutSide === "right"
                            ? "left-full ml-1"
                            : "right-full mr-1",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectMode?.("skill");
                            setSkillFlyoutOpen(false);
                            setOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-accent/50"
                        >
                          <span className="text-muted-foreground">
                            <IconBulb className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-foreground">
                              Create new skill
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                              Describe a skill and let the agent draft it
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSkillFlyoutOpen(false);
                            skillFileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-accent/50"
                        >
                          <span className="text-muted-foreground">
                            <IconUpload className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-foreground">
                              Upload skill file
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                              Import an existing SKILL.md file
                            </div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view === "skill-upload" && (
            <div className="p-3">
              <button
                type="button"
                onClick={() => setView("menu")}
                className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <IconArrowLeft className="h-3 w-3 rtl:-scale-x-100" />
                Back
              </button>
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Upload skill file
              </label>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground/60">
                Review the content from{" "}
                <span className="font-mono">
                  {skillUploadFileName || "the selected file"}
                </span>{" "}
                before saving.
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                Skill name
              </label>
              <input
                value={skillUploadSlug}
                onChange={(e) => setSkillUploadSlug(e.target.value)}
                className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="my-skill"
              />
              <p className="mb-2 text-[10px] text-muted-foreground/60">
                Saved at{" "}
                <span className="font-mono">
                  skills/{slugifyName(skillUploadSlug || "uploaded-skill")}
                  /SKILL.md
                </span>
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                Content
              </label>
              <textarea
                value={skillUploadContent}
                onChange={(e) => setSkillUploadContent(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-accent"
              />
              {skillUploadStatus && (
                <div
                  className={cn(
                    "mt-2 text-[11px] leading-snug",
                    skillUploadStatus.kind === "ok"
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {skillUploadStatus.message}
                </div>
              )}
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitSkillUpload}
                  disabled={
                    skillUploadBusy ||
                    !skillUploadContent.trim() ||
                    !skillUploadSlug.trim()
                  }
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {skillUploadBusy ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <McpIntegrationDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        defaultScope={defaultMcpScope}
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrg}
        onCreateMcpServer={(args) => createMcp.mutateAsync(args)}
      />
      <AssetsPickerModal
        open={assetsPickerOpen}
        onOpenChange={setAssetsPickerOpen}
      />
    </>
  );
}

function AssetsPickerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [pickerReady, setPickerReady] = useState(false);
  const sourceUrl = useMemo(() => assetPickerUrl(), []);
  const iframeUrl = useMemo(() => withEmbeddedParams(sourceUrl), [sourceUrl]);
  const targetOrigin = useMemo(() => assetPickerOrigin(iframeUrl), [iframeUrl]);
  const configurePicker = useCallback(() => {
    if (!targetOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(
      embedEnvelope("message", {
        name: "configure",
        payload: { mediaType: "image", count: 3 },
      }),
      targetOrigin,
    );
  }, [targetOrigin]);

  useEffect(() => {
    if (open) setPickerReady(false);
  }, [iframeUrl, open]);

  useEffect(() => {
    if (!open || !targetOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== targetOrigin) return;
      if (!isEmbedEnvelope(event.data)) return;

      if (event.data.type === "ready") {
        setPickerReady(true);
        configurePicker();
        return;
      }

      if (event.data.type !== "message") return;
      if (event.data.name === "close") {
        onOpenChange(false);
        return;
      }
      if (
        event.data.name !== "chooseImage" &&
        event.data.name !== "chooseAsset"
      )
        return;

      const url = assetImageSource(event.data.payload);
      if (!url) return;
      const title = assetTitle(event.data.payload, url);
      const assetId =
        event.data.payload && typeof event.data.payload === "object"
          ? assetString((event.data.payload as AssetPickerPayload).assetId)
          : null;
      setAgentChatContextItem({
        key: `asset-image:${assetId ?? url}`,
        title: `Image: ${title}`,
        context: assetContext(event.data.payload, url),
      });
      onOpenChange(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("keydown", handleKey);
    };
  }, [configurePicker, onOpenChange, open, targetOrigin]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[280] flex items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="composer-assets-picker-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex h-[min(86vh,760px)] w-[min(96vw,1040px)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div
            id="composer-assets-picker-title"
            className="text-sm font-medium text-foreground"
          >
            Generate image
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close image picker"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        {targetOrigin ? (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            {!pickerReady && <AssetsPickerLoadingSkeleton />}
            <iframe
              ref={iframeRef}
              src={iframeUrl}
              title="Assets image picker"
              className={cn(
                "absolute inset-0 h-full w-full border-0 bg-background transition-opacity duration-150",
                pickerReady ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              allow="clipboard-read; clipboard-write; microphone; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => {
                configurePicker();
                setPickerReady(true);
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            The configured image picker URL is not valid.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function AssetsPickerLoadingSkeleton() {
  return (
    <div
      className="absolute inset-0 flex flex-col gap-5 p-5"
      role="status"
      aria-label="Loading Assets picker"
    >
      <div className="flex items-center gap-3">
        <div className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-2">
            <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
