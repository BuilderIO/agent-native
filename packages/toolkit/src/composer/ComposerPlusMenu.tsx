import { useComposerRuntime } from "@assistant-ui/react";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "../ui/button.js";
import { DropdownMenuGroup, DropdownMenuItem } from "../ui/dropdown-menu.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../utils.js";
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
  const defaultActionIds = new Set(defaults.items.map((item) => item.id));
  const menuActionItems = mergedItems.filter((item) =>
    defaultActionIds.has(item.id),
  );
  const contextItems = mergedItems.filter(
    (item) => !defaultActionIds.has(item.id),
  );
  return (
    <>
      <ComposerContextMenu
        {...props}
        items={contextItems}
        menuActionItems={menuActionItems}
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
  const mergedTerminalItems =
    mode === "terminal"
      ? mergeComposerMenuItems(terminalItems, contextMenuItems)
      : contextMenuItems;
  const terminalActionIds = new Set(terminalItems.map((item) => item.id));
  return (
    <ComposerContextMenu
      {...props}
      items={mergedTerminalItems.filter(
        (item) => !terminalActionIds.has(item.id),
      )}
      menuActionItems={mergedTerminalItems.filter((item) =>
        terminalActionIds.has(item.id),
      )}
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
