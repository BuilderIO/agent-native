import { useComposerRuntime } from "@assistant-ui/react";
import {
  IconBolt,
  IconCalendarTime,
  IconCode,
  IconLoader2,
  IconPlugConnected,
  IconSchool,
} from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { uploadedSkillSlug } from "../skill-upload.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../utils.js";
import { formatAttachmentError } from "./attachment-accept.js";
import {
  ComposerContextMenu,
  type ComposerContextMenuItem,
  type ComposerContextMenuProps,
} from "./ComposerContextMenu.js";
import {
  useComposerRuntimeAdapters,
  type AgentComposerReference,
} from "./runtime-adapters.js";
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
  onSelectIntegration?: (reference: AgentComposerReference) => void;
  onSelectMode?: (mode: ComposerMode) => void;
  attachmentsEnabled?: boolean;
  extensionTools?: boolean;
  mode?: "full" | "upload-only" | "terminal";
  terminalModeControl?: ComposerTerminalModeControl;
  contextMenuItems?: readonly ComposerContextMenuItem[];
}

type View = "menu" | "skill-upload";

export function isExtensionComposerMenuEnabled(
  extensionTools?: boolean,
): boolean {
  return extensionTools === true;
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
  const defaultIds = new Set(defaults.map((item) => item.id));
  const overrides = new Map<string, ComposerContextMenuItem>();
  const seen = new Set<string>();
  const retain = (
    items: readonly ComposerContextMenuItem[],
    inheritedDisabled = false,
  ): ComposerContextMenuItem[] =>
    items.flatMap((item): ComposerContextMenuItem[] => {
      if (seen.has(item.id)) return [];
      seen.add(item.id);
      if (defaultIds.has(item.id)) {
        overrides.set(
          item.id,
          inheritedDisabled ? { ...item, disabled: true } : item,
        );
        return [];
      }
      if (!item.children) return [item];
      const children = retain(
        item.children,
        inheritedDisabled || item.disabled === true,
      );
      return children.length ? [{ ...item, children }] : [];
    });
  const context = retain(provided);
  return [
    ...context,
    ...defaults.map((item) => {
      const override = overrides.get(item.id);
      const section = override?.section ?? item.section;
      return override
        ? {
            ...override,
            ...(item.order === undefined ? {} : { order: item.order }),
            ...(section === undefined ? {} : { section }),
            icon: override.icon ?? item.icon,
          }
        : item;
    }),
  ];
}

export function useComposerDefaultActions({
  onSelectMode,
  extensionTools = false,
  disabled,
  onRestoreFocus,
  integrationStatus,
}: Pick<
  ComposerPlusMenuProps,
  | "onSelectMode"
  | "extensionTools"
  | "disabled"
  | "onRestoreFocus"
  | "integrationStatus"
>) {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate;
  const resources = adapters.resources!;
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const showMcpIntegrations =
    !resources.useWorkspaceMenu &&
    resources.isMcpIntegrationAvailable?.() === true;
  const { data: org } = resources.useOrg!();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const createMcp = resources.useCreateMcpServer!();
  const McpIntegrationDialog = resources.McpIntegrationDialog;
  const [view, setView] = useState<View>("menu");
  const skillFileInputRef = useRef<HTMLInputElement>(null);
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
  const invalidateSkillWork = useCallback(() => {
    skillEpoch.current++;
    skillRequest.current?.abort();
    skillRequest.current = null;
    if (skillCloseTimer.current !== null) clearTimeout(skillCloseTimer.current);
    skillCloseTimer.current = null;
  }, []);
  const cancelSkillWork = invalidateSkillWork;
  useEffect(() => cancelSkillWork, [cancelSkillWork, adapters.resolvePath]);
  useEffect(() => {
    if (!disabled) return;
    cancelSkillWork();
    setView("menu");
    setMcpDialogOpen(false);
  }, [disabled, cancelSkillWork]);
  useEffect(() => {
    setView("menu");
    return cancelSkillWork;
  }, [integrationStatus?.scopeKey, cancelSkillWork]);
  useEffect(() => {
    const input = skillFileInputRef.current;
    const restore = () => onRestoreFocus?.();
    input?.addEventListener("cancel", restore);
    return () => input?.removeEventListener("cancel", restore);
  }, [onRestoreFocus]);
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
    invalidateSkillWork();
    const epoch = skillEpoch.current;
    setSkillUploadStatus(null);
    setSkillUploadFileName(file.name);
    setView("skill-upload");
    try {
      const content = await file.text();
      if (skillEpoch.current !== epoch) return;
      setSkillUploadSlug(uploadedSkillSlug(file.name, content));
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
            uniqueSkillPath: true,
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
        if (skillEpoch.current === epoch) resetSkillUpload();
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
      id: "schedule-task",
      section: "commands" as const,
      order: 10,
      icon: <IconCalendarTime />,
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
      section: "commands" as const,
      order: 20,
      icon: <IconBolt />,
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
            section: "commands" as const,
            order: 40,
            icon: <IconCode />,
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
            opensDialog: true,
            section: "integrations" as const,
            order: 50,
            icon: <IconPlugConnected />,
            label: t("agentChat.composer.menu.integrations", {
              defaultValue: "Integrations",
            }),
            keywords: [
              t("agentChat.composer.menu.integrationsDescription", {
                defaultValue: "Connect tools and services to the agent",
              }),
            ],
            onSelect: () => {
              setMcpDialogOpen(true);
            },
          },
        ]
      : []),
    {
      id: "create-skill",
      section: "commands" as const,
      order: 30,
      icon: <IconSchool />,
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
      disabled: !onSelectMode,
      onSelect: () => onSelectMode?.("skill"),
    },
    {
      id: "upload-skill",
      opensDialog: true,
      section: "commands",
      order: 35,
      icon: <IconSchool />,
      label: t("agentChat.composer.skill.uploadFile", {
        defaultValue: "Upload skill file",
      }),
      onSelect: () => {
        resetSkillUpload();
        skillFileInputRef.current?.click();
      },
    },
  ];

  return {
    items,
    restoreFocus: onRestoreFocus,
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
        <Dialog
          open={view === "skill-upload"}
          onOpenChange={(open) => {
            if (!open) resetSkillUpload();
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            closeLabel={t("agentChat.common.close", { defaultValue: "Close" })}
            onCloseAutoFocus={(event) => {
              if (onRestoreFocus) {
                event.preventDefault();
                onRestoreFocus();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t("agentChat.composer.skill.uploadFile", {
                  defaultValue: "Upload skill file",
                })}
              </DialogTitle>
            </DialogHeader>
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetSkillUpload}
                >
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
          </DialogContent>
        </Dialog>
        {McpIntegrationDialog ? (
          <McpIntegrationDialog
            open={mcpDialogOpen}
            onOpenChange={(open: boolean) => {
              setMcpDialogOpen(open);
              if (!open) onRestoreFocus?.();
            }}
            defaultScope="org"
            canCreateOrgMcp={canCreateOrgMcp}
            hasOrg={Boolean(org?.orgId)}
            onCreateMcpServer={(args: unknown) => createMcp.mutateAsync(args)}
          />
        ) : null}
      </>
    ),
  };
}

function ComposerFullContextMenu(props: ComposerPlusMenuProps) {
  const defaults = useComposerDefaultActions(props);
  const runtime = useComposerRuntime();
  const mergedItems = mergeComposerMenuItems(
    defaults.items,
    props.contextMenuItems ?? [],
  );
  return (
    <>
      <ComposerContextMenu
        {...props}
        items={mergedItems}
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
  onSelectIntegration,
  addAttachment,
  onAttachmentRequest,
  ...props
}: ComposerPlusMenuProps) {
  const runtime = useComposerRuntime();
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate;
  const workspace = adapters.resources?.useWorkspaceMenu?.({
    enabled: props.open === true && mode !== "terminal",
    ...(props.onRestoreFocus ? { onRestoreFocus: props.onRestoreFocus } : {}),
    onSelectIntegration: (reference) => {
      if (!onSelectIntegration)
        throw new Error(
          t("agentChat.composer.contextActionFailed", {
            defaultValue: "Could not add context.",
          }),
        );
      onSelectIntegration(reference);
    },
  });
  const scopeEntries = (
    entries: readonly ComposerContextMenuItem[],
  ): ComposerContextMenuItem[] =>
    entries.map((entry) => {
      if (
        entry.picker &&
        entry.picker.identityScope === "workspace" &&
        workspace?.scopeKey !== undefined
      )
        return {
          ...entry,
          picker: { ...entry.picker, scopeKey: workspace.scopeKey },
        };
      return entry.children
        ? { ...entry, children: scopeEntries(entry.children) }
        : entry;
    });
  contextMenuItems = scopeEntries(
    mode === "terminal"
      ? contextMenuItems
      : mergeComposerMenuItems(workspace?.items ?? [], contextMenuItems),
  );
  if (mode === "full") {
    return (
      <>
        <ComposerFullContextMenu
          {...props}
          {...(workspace ? { integrationStatus: workspace } : {})}
          {...(addAttachment ? { addAttachment } : {})}
          {...(onAttachmentRequest ? { onAttachmentRequest } : {})}
          attachmentsEnabled={attachmentsEnabled}
          contextMenuItems={contextMenuItems}
        />
        {workspace?.overlays}
      </>
    );
  }
  const terminalItems: ComposerContextMenuItem[] = terminalModeControl
    ? [
        {
          id: "terminal-primary",
          order: 10,
          label: t("agentPanel.newTerminal", {
            defaultValue: "New terminal",
          }),
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
          order: 20,
          label: t("agentPanel.cliTerminalMode", {
            defaultValue: "CLI terminal mode",
          }),
          checked: terminalModeControl.enabled,
          onSelect: () =>
            terminalModeControl.onChange(!terminalModeControl.enabled),
        },
      ]
    : [];
  const mergedTerminalItems =
    mode === "terminal"
      ? mergeComposerMenuItems(terminalItems, contextMenuItems)
      : contextMenuItems;
  const terminalActionIds = new Set(terminalItems.map((item) => item.id));
  return (
    <>
      <ComposerContextMenu
        {...props}
        {...(mode !== "terminal" && workspace
          ? { integrationStatus: workspace }
          : {})}
        items={
          mode === "terminal"
            ? mergedTerminalItems.filter(
                (item) => !terminalActionIds.has(item.id),
              )
            : contextMenuItems
        }
        menuActionItems={
          mode === "terminal"
            ? mergedTerminalItems.filter((item) =>
                terminalActionIds.has(item.id),
              )
            : []
        }
        {...(mode === "upload-only" && attachmentsEnabled
          ? { addAttachment: addAttachment ?? runtime.addAttachment }
          : {})}
        {...(mode === "upload-only" && onAttachmentRequest
          ? { onAttachmentRequest }
          : {})}
      />
      {workspace?.overlays}
    </>
  );
}
