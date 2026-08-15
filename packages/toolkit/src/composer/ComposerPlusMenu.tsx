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
  IconHelpCircle,
  IconTerminal2,
} from "@tabler/icons-react";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";

import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover.js";
import { Switch } from "../ui/switch.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import {
  createAssetPickerHandoffId,
  isExternalAssetPickerUrl,
  standaloneAssetPickerUrl,
} from "./asset-picker-url.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { ComposerMode } from "./types.js";

export interface ComposerTerminalModeControl {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

interface ComposerPlusMenuProps {
  onSelectMode?: (mode: ComposerMode) => void;
  onAttachmentError?: (message: string) => void;
  /**
   * Show the "Create Extension" entry. Extensions are optional and hidden
   * unless the host explicitly enables their agent tool surface.
   */
  extensionTools?: boolean;
  /**
   * "full" (default): full + menu with Upload File, Create Skill, Schedule Task,
   * Automation, and MCP Server. Extension is included only when
   * `extensionTools` is true. "upload-only": clicking + opens the file picker
   * directly — no popover, no other modes. Use for prompt popovers where the
   * only thing to attach is a file. "terminal": one terminal/attachment action
   * plus the Terminal mode switch.
   */
  mode?: "full" | "upload-only" | "terminal";
  terminalModeControl?: ComposerTerminalModeControl;
}

type View = "menu" | "skill-upload";

const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";
const EMBED_PROTOCOL = "agent-native.embed";
const EMBED_VERSION = 1;

export function isExtensionComposerMenuEnabled(
  extensionTools?: boolean,
): boolean {
  return extensionTools === true;
}

interface EmbedEnvelope<TPayload = unknown> {
  protocol?: string;
  version?: number;
  type?: string;
  name?: string;
  payload?: TPayload;
}

interface AssetPickerPayload {
  assetId?: unknown;
  handoffId?: unknown;
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
  const env =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env ?? {};
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

function assetTitle(
  payload: unknown,
  url: string,
  generatedImageLabel: string,
): string {
  if (payload && typeof payload === "object") {
    const title = assetString((payload as AssetPickerPayload).title);
    if (title) return title;
    const prompt = assetString((payload as AssetPickerPayload).prompt);
    if (prompt) return prompt.slice(0, 80);
  }
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : generatedImageLabel;
  } catch {
    return generatedImageLabel;
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

function MenuItemHelp({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  const normalizedDescription = description?.trim();
  if (!normalizedDescription) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={`${label}: ${normalizedDescription}`}
          onClick={(event) => event.stopPropagation()}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <IconHelpCircle
            aria-hidden="true"
            className="size-3"
            strokeWidth={1.8}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        {normalizedDescription}
      </TooltipContent>
    </Tooltip>
  );
}

function UploadOnlyAttachButton({
  onAttachmentError,
}: Pick<ComposerPlusMenuProps, "onAttachmentError">) {
  const composerRuntime = useComposerRuntime();
  const t = useComposerRuntimeAdapters().translate!;
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await Promise.all(
        Array.from(files).map((file) => composerRuntime.addAttachment(file)),
      );
    } catch (error) {
      onAttachmentError?.(
        formatAttachmentError(
          error,
          t("agentChat.composer.uploadFailed", {
            defaultValue: "Could not upload the selected file.",
          }),
        ),
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
              aria-label={t("agentChat.composer.upload", {
                defaultValue: "Upload",
              })}
              onClick={() => inputRef.current?.click()}
            >
              <IconPlus className="h-4 w-4" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t("agentChat.composer.upload", { defaultValue: "Upload" })}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

export function ComposerPlusMenu({
  onSelectMode,
  onAttachmentError,
  extensionTools = false,
  mode = "full",
  terminalModeControl,
}: ComposerPlusMenuProps) {
  if (mode === "upload-only") {
    return <UploadOnlyAttachButton onAttachmentError={onAttachmentError} />;
  }
  if (mode === "terminal" && terminalModeControl) {
    return (
      <ComposerPlusMenuTerminal
        onAttachmentError={onAttachmentError}
        terminalModeControl={terminalModeControl}
      />
    );
  }
  return (
    <ComposerPlusMenuFull
      onSelectMode={onSelectMode}
      onAttachmentError={onAttachmentError}
      extensionTools={extensionTools}
    />
  );
}

function ComposerPlusMenuTerminal({
  onAttachmentError,
  terminalModeControl,
}: Pick<
  ComposerPlusMenuProps,
  "onAttachmentError" | "terminalModeControl"
>) {
  const composerRuntime = useComposerRuntime();
  const t = useComposerRuntimeAdapters().translate!;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  if (!terminalModeControl) return null;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await Promise.all(
        Array.from(files).map((file) => composerRuntime.addAttachment(file)),
      );
    } catch (error) {
      onAttachmentError?.(
        formatAttachmentError(
          error,
          t("agentChat.composer.uploadFailed", {
            defaultValue: "Could not upload the selected file.",
          }),
        ),
      );
    }
  };

  const handlePrimaryAction = () => {
    if (!terminalModeControl.enabled) {
      terminalModeControl.onChange(true);
      setOpen(false);
      return;
    }
    setOpen(false);
    inputRef.current?.click();
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            aria-label="Terminal and attachment options"
            title="Terminal and attachment options"
          >
            <IconPlus className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-56 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[12px] font-medium text-foreground hover:bg-accent/60"
            onClick={handlePrimaryAction}
          >
            {terminalModeControl.enabled ? (
              <IconUpload
                size={14}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <IconTerminal2
                size={14}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span>
              {terminalModeControl.enabled ? "Add attachments" : "Start terminal"}
            </span>
          </button>
          <div className="my-1 border-t border-border/70" />
          <div className="flex items-center justify-between gap-3 px-2.5 py-2">
            <span className="text-[12px] font-medium text-foreground">
              Terminal mode
            </span>
            <Switch
              checked={terminalModeControl.enabled}
              onCheckedChange={terminalModeControl.onChange}
              aria-label="Terminal mode"
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function ComposerPlusMenuFull({
  onSelectMode,
  onAttachmentError,
  extensionTools,
}: Pick<
  ComposerPlusMenuProps,
  "onSelectMode" | "onAttachmentError" | "extensionTools"
>) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const resources = adapters.resources!;
  const composerRuntime = useComposerRuntime();
  const [open, setOpen] = useState(false);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const showMcpIntegrations = useMemo(
    () => resources.isMcpIntegrationAvailable!(),
    [resources],
  );

  const { data: org } = resources.useOrg!();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const hasOrg = !!org?.orgId;
  // Composer connections belong to the person asking for them. Organization
  // sharing remains an explicit choice for owners and admins in the dialog.
  const defaultMcpScope: "user" = "user";
  const createMcp = resources.useCreateMcpServer!();
  const McpIntegrationDialog = resources.McpIntegrationDialog;

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
        formatAttachmentError(
          error,
          t("agentChat.composer.uploadFailed", {
            defaultValue: "Could not upload the selected file.",
          }),
        ),
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
      const res = await fetch(
        adapters.resolvePath!("/_agent-native/resources"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path,
            content: skillUploadContent,
            mimeType: "text/markdown",
            shared: false,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          body ||
            t("agentChat.composer.skill.uploadFailedStatus", {
              status: res.status,
              defaultValue: `Upload failed (${res.status})`,
            }),
        );
      }
      setSkillUploadStatus({
        kind: "ok",
        message: t("agentChat.composer.skill.added", {
          name: skillUploadFileName || `${slug}/SKILL.md`,
          defaultValue: `Skill "${skillUploadFileName || `${slug}/SKILL.md`}" added`,
        }),
      });
      window.setTimeout(() => setOpen(false), 1200);
    } catch (err: any) {
      setSkillUploadStatus({
        kind: "err",
        message:
          err?.message ||
          t("agentChat.composer.skill.saveFailed", {
            defaultValue: "Failed to save skill file",
          }),
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
    isSkill?: boolean;
  }[] = [
    {
      icon: <IconUpload className="h-3.5 w-3.5" />,
      label: t("agentChat.composer.menu.uploadFile", {
        defaultValue: "Upload File",
      }),
      desc: t("agentChat.composer.menu.uploadFileDescription", {
        defaultValue: "Images, PDFs, text/code, JSON, CSV",
      }),
      action: () => {
        setOpen(false);
        setTimeout(() => fileUploadRef.current?.click(), 0);
      },
    },
    {
      icon: <IconPhotoPlus className="h-3.5 w-3.5" />,
      label: t("agentChat.composer.menu.generateImage", {
        defaultValue: "Generate Image",
      }),
      desc: t("agentChat.composer.menu.generateImageDescription", {
        defaultValue: "Open the Assets image picker",
      }),
      action: () => {
        setOpen(false);
        setAssetsPickerOpen(true);
      },
    },
    {
      icon: <IconClock className="h-3.5 w-3.5" />,
      label: t("agentChat.composer.menu.scheduleTask", {
        defaultValue: "Schedule Task",
      }),
      desc: t("agentChat.composer.menu.scheduleTaskDescription", {
        defaultValue: "Run something on a schedule",
      }),
      action: () => {
        onSelectMode?.("job");
        setOpen(false);
      },
    },
    {
      icon: <IconBolt className="h-3.5 w-3.5" />,
      label: t("agentChat.composer.menu.createAutomation", {
        defaultValue: "Create Automation",
      }),
      desc: t("agentChat.composer.menu.createAutomationDescription", {
        defaultValue: "Set up a when-X-do-Y rule",
      }),
      action: () => {
        onSelectMode?.("automation");
        setOpen(false);
      },
    },
    ...(isExtensionComposerMenuEnabled(extensionTools)
      ? [
          {
            icon: <IconTool className="h-3.5 w-3.5" />,
            label: t("agentChat.composer.menu.createExtension", {
              defaultValue: "Create Extension",
            }),
            desc: t("agentChat.composer.menu.createExtensionDescription", {
              defaultValue: "Build a mini app extension",
            }),
            action: () => {
              onSelectMode?.("extension");
              setOpen(false);
            },
          },
        ]
      : []),
    ...(showMcpIntegrations
      ? [
          {
            icon: <IconPlugConnected className="h-3.5 w-3.5" />,
            label: t("agentChat.composer.menu.integrations", {
              defaultValue: "Integrations",
            }),
            desc: t("agentChat.composer.menu.integrationsDescription", {
              defaultValue: "Connect tools and services to the agent",
            }),
            action: () => {
              setOpen(false);
              setMcpDialogOpen(true);
            },
          },
        ]
      : []),
    {
      icon: <IconBulb className="h-3.5 w-3.5" />,
      label: t("agentChat.composer.menu.createSkill", {
        defaultValue: "Create Skill",
      }),
      desc: t("agentChat.composer.menu.createSkillDescription", {
        defaultValue: "Teach the agent a new ability",
      }),
      action: openSkillFlyout,
      hoverAction: openSkillFlyout,
      isSkill: true,
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
            <span className="inline-flex shrink-0">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("agentChat.composer.add", {
                    defaultValue: "Add...",
                  })}
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <IconPlus className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("agentChat.composer.add", { defaultValue: "Add..." })}
          </TooltipContent>
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
                const isSkill = item.isSkill === true;
                return (
                  <div
                    key={item.label}
                    className={cn(
                      "relative flex items-center hover:bg-accent/50",
                      isSkill && "group/skill",
                      isSkill && skillFlyoutOpen && "bg-accent/50",
                    )}
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
                        "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-start",
                      )}
                    >
                      <span className="text-muted-foreground">{item.icon}</span>
                      <span className="flex min-w-0 items-center gap-0.5">
                        <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                          {item.label}
                        </span>
                        <MenuItemHelp
                          label={item.label}
                          description={item.desc}
                        />
                      </span>
                    </button>
                    {isSkill && (
                      <span className="me-3 ms-auto text-muted-foreground/60">
                        ›
                      </span>
                    )}
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
                        <div className="flex items-center hover:bg-accent/50">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectMode?.("skill");
                              setSkillFlyoutOpen(false);
                              setOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-start"
                          >
                            <span className="text-muted-foreground">
                              <IconBulb className="h-3.5 w-3.5" />
                            </span>
                            <span className="flex min-w-0 items-center gap-0.5">
                              <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                                {t("agentChat.composer.skill.createNew", {
                                  defaultValue: "Create new skill",
                                })}
                              </span>
                              <MenuItemHelp
                                label={t("agentChat.composer.skill.createNew", {
                                  defaultValue: "Create new skill",
                                })}
                                description={t(
                                  "agentChat.composer.skill.createDescription",
                                  {
                                    defaultValue:
                                      "Describe a skill and let the agent draft it",
                                  },
                                )}
                              />
                            </span>
                          </button>
                        </div>
                        <div className="flex items-center hover:bg-accent/50">
                          <button
                            type="button"
                            onClick={() => {
                              setSkillFlyoutOpen(false);
                              skillFileInputRef.current?.click();
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-start"
                          >
                            <span className="text-muted-foreground">
                              <IconUpload className="h-3.5 w-3.5" />
                            </span>
                            <span className="flex min-w-0 items-center gap-0.5">
                              <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                                {t("agentChat.composer.skill.uploadFile", {
                                  defaultValue: "Upload skill file",
                                })}
                              </span>
                              <MenuItemHelp
                                label={t(
                                  "agentChat.composer.skill.uploadFile",
                                  {
                                    defaultValue: "Upload skill file",
                                  },
                                )}
                                description={t(
                                  "agentChat.composer.skill.uploadDescription",
                                  {
                                    defaultValue:
                                      "Import an existing SKILL.md file",
                                  },
                                )}
                              />
                            </span>
                          </button>
                        </div>
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
                {t("agentChat.composer.skill.back", {
                  defaultValue: "Back",
                })}
              </button>
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                {t("agentChat.composer.skill.uploadFile", {
                  defaultValue: "Upload skill file",
                })}
              </label>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground/60">
                {t("agentChat.composer.skill.review", {
                  name:
                    skillUploadFileName ||
                    t("agentChat.composer.skill.selectedFile", {
                      defaultValue: "the selected file",
                    }),
                  defaultValue: `Review the content from ${skillUploadFileName || "the selected file"} before saving.`,
                })}
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                {t("agentChat.composer.skill.name", {
                  defaultValue: "Skill name",
                })}
              </label>
              <input
                value={skillUploadSlug}
                onChange={(e) => setSkillUploadSlug(e.target.value)}
                className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="my-skill"
              />
              <p className="mb-2 text-[10px] text-muted-foreground/60">
                {t("agentChat.composer.skill.savedAt", {
                  defaultValue: "Saved at",
                })}{" "}
                <span className="font-mono">
                  skills/{slugifyName(skillUploadSlug || "uploaded-skill")}
                  /SKILL.md
                </span>
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                {t("agentChat.composer.skill.content", {
                  defaultValue: "Content",
                })}
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
                  {t("agentChat.common.cancel", {
                    defaultValue: "Cancel",
                  })}
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
                    t("agentChat.common.save", { defaultValue: "Save" })
                  )}
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {McpIntegrationDialog ? (
        <McpIntegrationDialog
          open={mcpDialogOpen}
          onOpenChange={setMcpDialogOpen}
          defaultScope={defaultMcpScope}
          canCreateOrgMcp={canCreateOrgMcp}
          hasOrg={hasOrg}
          onCreateMcpServer={(args: unknown) => createMcp.mutateAsync(args)}
        />
      ) : null}
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
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const standaloneWindowRef = useRef<Window | null>(null);
  const [pickerReady, setPickerReady] = useState(false);
  const [standaloneHandoffId, setStandaloneHandoffId] = useState<string | null>(
    null,
  );
  const sourceUrl = useMemo(() => assetPickerUrl(), []);
  const externalPicker = useMemo(
    () =>
      typeof window !== "undefined" &&
      isExternalAssetPickerUrl(sourceUrl, window.location.origin),
    [sourceUrl],
  );
  const standaloneUrl = useMemo(
    () =>
      standaloneAssetPickerUrl(
        sourceUrl,
        typeof window !== "undefined" ? window.location.href : undefined,
        {
          handoffId: standaloneHandoffId ?? undefined,
          returnOrigin:
            typeof window !== "undefined" ? window.location.origin : undefined,
        },
      ),
    [sourceUrl, standaloneHandoffId],
  );
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
    if (open) {
      setPickerReady(false);
      if (externalPicker) {
        standaloneWindowRef.current = null;
        setStandaloneHandoffId(createAssetPickerHandoffId());
      } else {
        setStandaloneHandoffId(null);
      }
      return;
    }
    if (!standaloneWindowRef.current) setStandaloneHandoffId(null);
  }, [externalPicker, iframeUrl, open]);

  useEffect(() => {
    if (
      !targetOrigin ||
      (!open && !standaloneWindowRef.current) ||
      (externalPicker && !standaloneHandoffId)
    )
      return;

    const handleMessage = (event: MessageEvent) => {
      const expectedSource = externalPicker
        ? standaloneWindowRef.current
        : iframeRef.current?.contentWindow;
      if (!expectedSource || event.source !== expectedSource) return;
      if (event.origin !== targetOrigin) return;
      if (!isEmbedEnvelope(event.data)) return;

      if (event.data.type === "ready") {
        setPickerReady(true);
        configurePicker();
        return;
      }

      if (event.data.type !== "message") return;
      if (externalPicker) {
        const payload = event.data.payload;
        const handoffId =
          payload && typeof payload === "object"
            ? assetString((payload as AssetPickerPayload).handoffId)
            : null;
        if (handoffId !== standaloneHandoffId) return;
      }
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
      const title = assetTitle(
        event.data.payload,
        url,
        t("agentChat.composer.assets.generatedImage", {
          defaultValue: "Generated image",
        }),
      );
      const assetId =
        event.data.payload && typeof event.data.payload === "object"
          ? assetString((event.data.payload as AssetPickerPayload).assetId)
          : null;
      adapters.agentChat!.setContextItem!({
        key: `asset-image:${assetId ?? url}`,
        title: t("agentChat.composer.assets.contextTitle", {
          title,
          defaultValue: `Image: ${title}`,
        }),
        context: assetContext(event.data.payload, url),
      });
      standaloneWindowRef.current = null;
      setStandaloneHandoffId(null);
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
  }, [
    configurePicker,
    adapters,
    externalPicker,
    onOpenChange,
    open,
    standaloneHandoffId,
    t,
    targetOrigin,
  ]);

  const openStandalonePicker = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!standaloneHandoffId) return;
      event.preventDefault();
      const pickerWindow = window.open(standaloneUrl, "_blank");
      if (!pickerWindow) return;
      standaloneWindowRef.current = pickerWindow;
      onOpenChange(false);
    },
    [onOpenChange, standaloneHandoffId, standaloneUrl],
  );

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
            {t("agentChat.composer.assets.generateImage", {
              defaultValue: "Generate image",
            })}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("agentChat.composer.assets.closePicker", {
              defaultValue: "Close image picker",
            })}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        {externalPicker ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="max-w-md text-sm text-muted-foreground">
              {t("agentChat.composer.assets.openSecurely", {
                defaultValue:
                  "Open Assets in a new tab to sign in and choose an image securely.",
              })}
            </div>
            <a
              href={standaloneUrl}
              target="_blank"
              onClick={openStandalonePicker}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("agentChat.composer.assets.openPicker", {
                defaultValue: "Open Assets image picker",
              })}
            </a>
          </div>
        ) : targetOrigin ? (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            {!pickerReady && <AssetsPickerLoadingSkeleton />}
            <iframe
              ref={iframeRef}
              src={iframeUrl}
              title={t("agentChat.composer.assets.pickerTitle", {
                defaultValue: "Assets image picker",
              })}
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
            {t("agentChat.composer.assets.invalidUrl", {
              defaultValue: "The configured image picker URL is not valid.",
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function AssetsPickerLoadingSkeleton() {
  const t = useComposerRuntimeAdapters().translate!;
  return (
    <div
      className="absolute inset-0 flex flex-col gap-5 p-5"
      role="status"
      aria-label={t("agentChat.composer.assets.loadingPicker", {
        defaultValue: "Loading Assets picker",
      })}
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
