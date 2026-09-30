import { useComposerRuntime } from "@assistant-ui/react";
import { IconArrowLeft, IconLoader2, IconX } from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/button.js";
import { DropdownMenuGroup, DropdownMenuItem } from "../ui/dropdown-menu.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../utils.js";
import {
  createAssetPickerHandoffId,
  isExternalAssetPickerUrl,
  standaloneAssetPickerUrl,
} from "./asset-picker-url.js";
import { formatAttachmentError } from "./attachment-accept.js";
import {
  ComposerContextMenu,
  type ComposerContextMenuItem,
  type ComposerContextMenuProps,
  type ComposerContextPageControls,
} from "./ComposerContextMenu.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { ComposerMode } from "./types.js";

export interface ComposerTerminalModeControl {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  onNewTerminal?: () => void;
}

interface ComposerPlusMenuProps extends Omit<
  ComposerContextMenuProps,
  "items"
> {
  onSelectMode?: (mode: ComposerMode) => void;
  attachmentsEnabled?: boolean;
  extensionTools?: boolean;
  mode?: "full" | "upload-only" | "terminal";
  terminalModeControl?: ComposerTerminalModeControl;
  contextMenuItems?: readonly ComposerContextMenuItem[];
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

export function mergeComposerMenuItems(
  defaults: readonly ComposerContextMenuItem[],
  provided: readonly ComposerContextMenuItem[],
): ComposerContextMenuItem[] {
  const ids = new Set<string>();
  const visit = (items: readonly ComposerContextMenuItem[]) => {
    for (const item of items) {
      ids.add(item.id);
      if (item.children) visit(item.children);
    }
  };
  visit(provided);
  return [...provided, ...defaults.filter((item) => !ids.has(item.id))];
}

export function useComposerDefaultActions({
  onSelectMode,
  extensionTools = false,
  disabled,
  onRestoreFocus,
}: Pick<
  ComposerPlusMenuProps,
  "onSelectMode" | "extensionTools" | "disabled" | "onRestoreFocus"
>) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const resources = adapters.resources!;
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const overlayOpen = useRef(false);
  const showMcpIntegrations = resources.isMcpIntegrationAvailable!();
  const { data: org } = resources.useOrg!();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const createMcp = resources.useCreateMcpServer!();
  const McpIntegrationDialog = resources.McpIntegrationDialog;
  const [view, setView] = useState<View>("menu");
  const skillFileInputRef = useRef<HTMLInputElement>(null);
  const skillControls = useRef<ComposerContextPageControls | null>(null);
  const skillEpoch = useRef(0);
  const skillRequest = useRef<AbortController | null>(null);
  const skillCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skillUploadSlug, setSkillUploadSlug] = useState("");
  const [skillUploadContent, setSkillUploadContent] = useState("");
  const [skillUploadFileName, setSkillUploadFileName] = useState("");
  const [skillUploadStatus, setSkillUploadStatus] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);
  const [skillUploadBusy, setSkillUploadBusy] = useState(false);
  const formId = useId();
  const cancelSkillWork = useCallback(() => {
    skillEpoch.current++;
    skillRequest.current?.abort();
    skillRequest.current = null;
    if (skillCloseTimer.current !== null) clearTimeout(skillCloseTimer.current);
    skillCloseTimer.current = null;
  }, []);
  useEffect(() => cancelSkillWork, [cancelSkillWork, adapters.resolvePath]);
  useEffect(() => {
    if (!disabled) return;
    cancelSkillWork();
    setAssetsPickerOpen(false);
    setMcpDialogOpen(false);
    overlayOpen.current = false;
  }, [disabled, cancelSkillWork]);
  const resetSkillUpload = () => {
    cancelSkillWork();
    setView("menu");
    setSkillUploadSlug("");
    setSkillUploadContent("");
    setSkillUploadFileName("");
    setSkillUploadStatus(null);
    setSkillUploadBusy(false);
  };
  const handleSkillFileSelected = async (file: File) => {
    cancelSkillWork();
    const epoch = skillEpoch.current;
    setSkillUploadStatus(null);
    try {
      const content = await file.text();
      if (skillEpoch.current !== epoch) return;
      const baseName = file.name.replace(/\.[^./]+$/, "");
      setSkillUploadSlug(
        slugifyName(
          baseName.toLowerCase() === "skill" ? "uploaded-skill" : baseName,
        ),
      );
      setSkillUploadContent(content);
      setSkillUploadFileName(file.name);
      setView("skill-upload");
    } catch (error) {
      if (skillEpoch.current !== epoch) return;
      setSkillUploadStatus({
        kind: "err",
        message: formatAttachmentError(
          error,
          t("agentChat.composer.skill.saveFailed", {
            defaultValue: "Failed to save skill file",
          }),
        ),
      });
    }
  };
  const submitSkillUpload = async () => {
    if (
      skillRequest.current ||
      !skillUploadSlug.trim() ||
      !skillUploadContent.trim()
    )
      return;
    const epoch = skillEpoch.current;
    const abort = new AbortController();
    skillRequest.current = abort;
    const slug = slugifyName(skillUploadSlug || "uploaded-skill");
    const path = `skills/${slug}/SKILL.md`;
    setSkillUploadBusy(true);
    setSkillUploadStatus(null);
    try {
      const res = await fetch(
        adapters.resolvePath!("/_agent-native/resources"),
        {
          method: "POST",
          signal: abort.signal,
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
        const body = await res.text();
        throw new Error(
          body ||
            t("agentChat.composer.skill.uploadFailedStatus", {
              status: res.status,
              defaultValue: `Upload failed (${res.status})`,
            }),
        );
      }
      if (skillEpoch.current !== epoch) return;
      setSkillUploadStatus({
        kind: "ok",
        message: t("agentChat.composer.skill.added", {
          name: skillUploadFileName || `${slug}/SKILL.md`,
          defaultValue: `Skill "${skillUploadFileName || `${slug}/SKILL.md`}" added`,
        }),
      });
      skillCloseTimer.current = setTimeout(() => {
        if (skillEpoch.current === epoch) skillControls.current?.onClose();
      }, 1200);
    } catch (error) {
      if (skillEpoch.current !== epoch) return;
      setSkillUploadStatus({
        kind: "err",
        message: formatAttachmentError(
          error,
          t("agentChat.composer.skill.saveFailed", {
            defaultValue: "Failed to save skill file",
          }),
        ),
      });
    } finally {
      if (skillEpoch.current === epoch) {
        skillRequest.current = null;
        setSkillUploadBusy(false);
      }
    }
  };

  const items: ComposerContextMenuItem[] = [
    {
      id: "generate-image",
      label: t("agentChat.composer.menu.generateImage", {
        defaultValue: "Generate Image",
      }),
      keywords: [
        t("agentChat.composer.menu.generateImageDescription", {
          defaultValue: "Open the Assets image picker",
        }),
      ],
      onSelect: () => {
        overlayOpen.current = true;
        setAssetsPickerOpen(true);
      },
    },
    {
      id: "schedule-task",
      label: t("agentChat.composer.menu.scheduleTask", {
        defaultValue: "Schedule Task",
      }),
      keywords: [
        t("agentChat.composer.menu.scheduleTaskDescription", {
          defaultValue: "Run something on a schedule",
        }),
      ],
      disabled: !onSelectMode,
      onSelect: () => onSelectMode?.("job"),
    },
    {
      id: "create-automation",
      label: t("agentChat.composer.menu.createAutomation", {
        defaultValue: "Create Automation",
      }),
      keywords: [
        t("agentChat.composer.menu.createAutomationDescription", {
          defaultValue: "Set up a when-X-do-Y rule",
        }),
      ],
      disabled: !onSelectMode,
      onSelect: () => onSelectMode?.("automation"),
    },
    ...(isExtensionComposerMenuEnabled(extensionTools)
      ? [
          {
            id: "create-extension",
            label: t("agentChat.composer.menu.createExtension", {
              defaultValue: "Create Extension",
            }),
            keywords: [
              t("agentChat.composer.menu.createExtensionDescription", {
                defaultValue: "Build a mini app extension",
              }),
            ],
            disabled: !onSelectMode,
            onSelect: () => onSelectMode?.("extension"),
          },
        ]
      : []),
    ...(showMcpIntegrations
      ? [
          {
            id: "integrations",
            label: t("agentChat.composer.menu.integrations", {
              defaultValue: "Integrations",
            }),
            keywords: [
              t("agentChat.composer.menu.integrationsDescription", {
                defaultValue: "Connect tools and services to the agent",
              }),
            ],
            onSelect: () => {
              overlayOpen.current = true;
              setMcpDialogOpen(true);
            },
          },
        ]
      : []),
    {
      id: "create-skill",
      label: t("agentChat.composer.menu.createSkill", {
        defaultValue: "Create Skill",
      }),
      keywords: [
        t("agentChat.composer.menu.createSkillDescription", {
          defaultValue: "Teach the agent a new ability",
        }),
        t("agentChat.composer.skill.uploadFile", {
          defaultValue: "Upload skill file",
        }),
      ],
      onSelect: resetSkillUpload,
      onDismiss: cancelSkillWork,
      render: (controls) => {
        skillControls.current = controls;
        return view === "menu" ? (
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!onSelectMode}
              onSelect={() => {
                controls.onClose();
                onSelectMode?.("skill");
              }}
            >
              {t("agentChat.composer.skill.createNew", {
                defaultValue: "Create new skill",
              })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                skillFileInputRef.current?.click();
              }}
            >
              {t("agentChat.composer.skill.uploadFile", {
                defaultValue: "Upload skill file",
              })}
            </DropdownMenuItem>
            {skillUploadStatus && (
              <div role="alert" className="p-3 text-sm text-destructive">
                {skillUploadStatus.message}
              </div>
            )}
          </DropdownMenuGroup>
        ) : (
          <form
            className="grid min-w-0 gap-2 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void submitSkillUpload();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "Tab")
                event.stopPropagation();
            }}
          >
            <Button
              type="button"
              variant="ghost"
              className="justify-start"
              onClick={resetSkillUpload}
            >
              <IconArrowLeft className="rtl:-scale-x-100" />
              {t("agentChat.composer.skill.back", { defaultValue: "Back" })}
            </Button>
            <p className="break-words text-xs text-muted-foreground">
              {t("agentChat.composer.skill.review", {
                name:
                  skillUploadFileName ||
                  t("agentChat.composer.skill.selectedFile", {
                    defaultValue: "the selected file",
                  }),
                defaultValue: `Review the content from ${skillUploadFileName || "the selected file"} before saving.`,
              })}
            </p>
            <Label htmlFor={`${formId}-name`}>
              {t("agentChat.composer.skill.name", {
                defaultValue: "Skill name",
              })}
            </Label>
            <Input
              id={`${formId}-name`}
              autoFocus
              value={skillUploadSlug}
              disabled={skillUploadBusy}
              onChange={(event) => setSkillUploadSlug(event.target.value)}
              placeholder="my-skill"
            />
            <p className="break-words text-xs text-muted-foreground">
              {t("agentChat.composer.skill.savedAt", {
                defaultValue: "Saved at",
              })}{" "}
              <span className="font-mono">
                skills/{slugifyName(skillUploadSlug || "uploaded-skill")}
                /SKILL.md
              </span>
            </p>
            <Label htmlFor={`${formId}-content`}>
              {t("agentChat.composer.skill.content", {
                defaultValue: "Content",
              })}
            </Label>
            <Textarea
              id={`${formId}-content`}
              value={skillUploadContent}
              disabled={skillUploadBusy}
              onChange={(event) => setSkillUploadContent(event.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            {skillUploadStatus && (
              <div
                role={skillUploadStatus.kind === "err" ? "alert" : "status"}
                className={cn(
                  "break-words text-xs",
                  skillUploadStatus.kind === "err"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {skillUploadStatus.message}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={resetSkillUpload}>
                {t("agentChat.common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                type="submit"
                disabled={
                  skillUploadBusy ||
                  skillUploadStatus?.kind === "ok" ||
                  !skillUploadContent.trim() ||
                  !skillUploadSlug.trim()
                }
              >
                {skillUploadBusy ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  t("agentChat.common.save", { defaultValue: "Save" })
                )}
              </Button>
            </div>
          </form>
        );
      },
    },
  ];

  return {
    items,
    restoreFocus: () => {
      if (!overlayOpen.current) onRestoreFocus?.();
    },
    overlays: (
      <>
        <input
          ref={skillFileInputRef}
          type="file"
          accept=".md,text/markdown"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleSkillFileSelected(file);
          }}
        />
        {McpIntegrationDialog ? (
          <McpIntegrationDialog
            open={mcpDialogOpen}
            onOpenChange={(open: boolean) => {
              overlayOpen.current = open;
              setMcpDialogOpen(open);
              if (!open) onRestoreFocus?.();
            }}
            defaultScope="user"
            canCreateOrgMcp={canCreateOrgMcp}
            hasOrg={Boolean(org?.orgId)}
            onCreateMcpServer={(args: unknown) => createMcp.mutateAsync(args)}
          />
        ) : null}
        <AssetsPickerModal
          open={assetsPickerOpen}
          onOpenChange={(open) => {
            overlayOpen.current = open;
            setAssetsPickerOpen(open);
            if (!open) onRestoreFocus?.();
          }}
        />
      </>
    ),
  };
}

function ComposerFullContextMenu(props: ComposerPlusMenuProps) {
  const defaults = useComposerDefaultActions(props);
  const runtime = useComposerRuntime();
  return (
    <>
      <ComposerContextMenu
        {...props}
        items={mergeComposerMenuItems(
          defaults.items,
          props.contextMenuItems ?? [],
        )}
        addAttachment={
          props.attachmentsEnabled === false
            ? undefined
            : (props.addAttachment ?? runtime.addAttachment)
        }
        onRestoreFocus={
          props.onRestoreFocus ? defaults.restoreFocus : undefined
        }
      />
      {defaults.overlays}
    </>
  );
}

export function ComposerPlusMenu({
  mode = "full",
  contextMenuItems = [],
  terminalModeControl,
  attachmentsEnabled = true,
  ...props
}: ComposerPlusMenuProps) {
  const runtime = useComposerRuntime();
  const t = useComposerRuntimeAdapters().translate!;
  if (mode === "full") {
    return (
      <ComposerFullContextMenu
        {...props}
        attachmentsEnabled={attachmentsEnabled}
        contextMenuItems={contextMenuItems}
      />
    );
  }
  const terminalItems: ComposerContextMenuItem[] = terminalModeControl
    ? [
        {
          id: "terminal-primary",
          label: t("agentPanel.newTerminal", { defaultValue: "New terminal" }),
          disabled:
            terminalModeControl.enabled && !terminalModeControl.onNewTerminal,
          onSelect: () => {
            if (terminalModeControl.enabled)
              terminalModeControl.onNewTerminal?.();
            else terminalModeControl.onChange(true);
          },
        },
        {
          id: "terminal-mode",
          label: t("agentPanel.cliTerminalMode", {
            defaultValue: "CLI terminal mode",
          }),
          checked: terminalModeControl.enabled,
          onSelect: () =>
            terminalModeControl.onChange(!terminalModeControl.enabled),
        },
      ]
    : [];
  return (
    <ComposerContextMenu
      {...props}
      items={
        mode === "terminal"
          ? mergeComposerMenuItems(terminalItems, contextMenuItems)
          : contextMenuItems
      }
      addAttachment={
        mode === "upload-only" && attachmentsEnabled
          ? (props.addAttachment ?? runtime.addAttachment)
          : undefined
      }
      onAttachmentRequest={
        mode === "upload-only" ? props.onAttachmentRequest : undefined
      }
    />
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
