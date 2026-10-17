import { useT } from "@agent-native/core/client/i18n";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import {
  IconArrowRight,
  IconBrush,
  IconDevices,
  IconFrame,
  IconHandClick,
  IconHandStop,
  IconHexagon,
  IconLine,
  IconMessage,
  IconOval,
  IconPhotoVideo,
  IconPointer,
  IconScale,
  IconScribble,
  IconSquare,
  IconStar,
  IconTransformPoint,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { DesignToolbarOption } from "@/components/design/editor/toolbar-controls";
import {
  DesignModeTab,
  DesignPenToolIcon,
  DesignToolbarTool,
} from "@/components/design/editor/toolbar-controls";
import { IconText } from "@/components/design/inspector/design-icons";
import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import {
  getActiveFrameGroupTool,
  getActivePenGroupTool,
  getActiveShapeGroupTool,
  getToolbarGroups,
  resolveGroupTool,
  type FrameGroupTool,
  type PenGroupTool,
  type ToolbarGroupId,
} from "@/pages/design-editor/floating-toolbar";
import {
  MOVE_GROUP_TOOL_PRESENTATIONS,
  getMoveGroupToolPresentation,
} from "@/pages/design-editor/tool-state";
import type {
  DesignTool,
  EditorMode,
  ShapeTool,
} from "@/pages/design-editor/types";

export const DESIGN_FILE_STORAGE_REQUIRED_EVENT =
  "design:file-storage-required";

/** One tool of a group: its menu row, and the group's main button while it is the one shown. */
type ToolDescriptor<Tool extends string> = {
  key: Tool;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  icon: (className: string) => ReactNode;
  select: () => void;
};

type ToolbarGroup = {
  id: ToolbarGroupId;
  active: boolean;
  label: string;
  /** The group's name, which names its chevron; the armed variant names the main button. */
  groupLabel: string;
  icon: ReactNode;
  primaryShortcut?: string;
  onClick: () => void;
  options: DesignToolbarOption[];
};

/**
 * The tool a group had armed last. State is set while rendering rather than in
 * an effect, so the main button is on the right icon in the frame the tool
 * changes, whoever changed it (a click, a hotkey, the agent).
 */
function useLastUsedTool<Tool extends string>(
  active: Tool | null,
  initial: Tool,
): Tool {
  const [lastUsed, setLastUsed] = useState(initial);
  if (active !== null && active !== lastUsed) setLastUsed(active);
  return lastUsed;
}

/**
 * A group whose main button arms one of several tools: the one in use, else the
 * last one, unarmed. The group is highlighted while any of its tools is armed.
 */
function buildToolVariantGroup<Tool extends string>({
  id,
  groupLabel,
  tools,
  active,
  lastUsed,
  extraOptions = [],
}: {
  id: ToolbarGroupId;
  groupLabel: string;
  tools: ToolDescriptor<Tool>[];
  active: Tool | null;
  lastUsed: Tool;
  extraOptions?: DesignToolbarOption[];
}): ToolbarGroup {
  const { tool, armed } = resolveGroupTool({
    active,
    lastUsed,
    available: tools.map((candidate) => candidate.key),
  });
  const main = tools.find((candidate) => candidate.key === tool)!;
  return {
    id,
    active: armed,
    label: main.label,
    groupLabel,
    icon: main.icon("size-4"),
    primaryShortcut: main.shortcut,
    onClick: main.select,
    options: [
      ...tools.map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        icon: candidate.icon("size-4"),
        shortcut: candidate.shortcut,
        active: candidate.key === active,
        disabled: candidate.disabled,
        onSelect: candidate.select,
      })),
      ...extraOptions,
    ],
  };
}

export function DesignBottomToolbar({
  mode,
  activeTool,
  drawMode,
  pinMode,
  hasActiveFile,
  frameToolDraws,
  onFrameToolDrawsChange,
  onMove,
  onHand,
  onScale,
  onFrame,
  onText,
  onShape,
  onMediaFiles,
  onPen,
  onDraw,
  onCommentPin,
  canComment,
  onModeChange,
  showModeTabs,
  annotateEnabled,
}: {
  mode: EditorMode;
  activeTool: DesignTool;
  drawMode: boolean;
  pinMode: boolean;
  hasActiveFile: boolean;
  frameToolDraws: FrameGroupTool;
  onFrameToolDrawsChange: (value: FrameGroupTool) => void;
  onMove: () => void;
  onHand: () => void;
  onScale: () => void;
  onFrame: () => void;
  onText: () => void;
  onShape: (tool: ShapeTool) => void;
  onMediaFiles: (files: File[]) => void;
  onPen: () => void;
  onDraw: () => void;
  /** Toggles the comment pin tool, which also opens the Threads panel. */
  onCommentPin: () => void;
  /** Comments and annotation drawing need a signed-in commenter; a widget's write ticket covers neither. */
  canComment: boolean;
  onModeChange: (mode: EditorMode) => void;
  /**
   * The Interact / Design / Annotate switch lives in the editor top bar, and in
   * Interact's own floating bar where that bar is absent. Shells with neither
   * (minimal UI, embedded chrome, the visual-edit route, hidden UI) still render
   * this toolbar, so it carries the switch there. In Interact no tool applies,
   * so the switch is all it shows.
   */
  showModeTabs: boolean;
  /** The Annotate lab: without it the Draw tool and the Annotate mode tab do not exist. */
  annotateEnabled: boolean;
}) {
  const t = useT();
  const annotateAvailable = annotateEnabled && canComment;
  const fileUploadStatus = useFileUploadStatus();
  const canUploadMedia =
    fileUploadStatus.isSuccess && fileUploadStatus.data.configured === true;
  const fileStorageMissing =
    fileUploadStatus.isSuccess && fileUploadStatus.data.configured === false;
  const fileStorageUnavailable = !fileUploadStatus.isSuccess;
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  const applePlatform = useApplePlatform();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  // Each group's main button keeps the last tool armed, so a second click draws
  // another Rectangle rather than going back to a Frame.
  const activeFrameTool = getActiveFrameGroupTool(activeTool, frameToolDraws);
  const activeShapeTool = getActiveShapeGroupTool(activeTool);
  const activePenTool = getActivePenGroupTool({
    activeTool,
    mode,
    drawMode,
    annotateAvailable,
  });
  const lastFrameTool = useLastUsedTool<FrameGroupTool>(
    activeFrameTool,
    frameToolDraws,
  );
  const lastShapeTool = useLastUsedTool<ShapeTool>(activeShapeTool, "rect");
  const lastPenTool = useLastUsedTool<PenGroupTool>(activePenTool, "pen");
  useEffect(() => {
    const openStorageSetup = () => setStorageSetupOpen(true);
    window.addEventListener(
      DESIGN_FILE_STORAGE_REQUIRED_EVENT,
      openStorageSetup,
    );
    return () =>
      window.removeEventListener(
        DESIGN_FILE_STORAGE_REQUIRED_EVENT,
        openStorageSetup,
      );
  }, []);
  useEffect(() => {
    if (canUploadMedia) setStorageSetupOpen(false);
  }, [canUploadMedia]);

  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const optionsLabel = (group: string) =>
    t("designEditor.tools.options", { tool: group });
  const moveGroup = ((): ToolbarGroup => {
    const groupLabel = t("designEditor.tools.move");
    const armed = getMoveGroupToolPresentation(activeTool);
    return {
      id: "move",
      active:
        (activeTool === "move" && mode === "edit") ||
        activeTool === "hand" ||
        activeTool === "scale",
      label: t(armed.labelKey),
      groupLabel,
      icon:
        armed.tool === "hand" ? (
          <IconHandStop className="size-4" />
        ) : armed.tool === "scale" ? (
          <IconScale className="size-4" />
        ) : (
          <IconPointer className="size-4" />
        ),
      primaryShortcut: armed.shortcut,
      onClick:
        armed.tool === "hand"
          ? onHand
          : armed.tool === "scale"
            ? onScale
            : onMove,
      options: [
        {
          key: "move",
          label: t("designEditor.tools.move"),
          icon: <IconPointer className="size-4" />,
          shortcut: MOVE_GROUP_TOOL_PRESENTATIONS.move.shortcut,
          active: activeTool === "move" && mode === "edit",
          onSelect: onMove,
        },
        {
          key: "hand",
          label: t("designEditor.tools.hand"),
          icon: <IconHandStop className="size-4" />,
          shortcut: MOVE_GROUP_TOOL_PRESENTATIONS.hand.shortcut,
          active: activeTool === "hand",
          onSelect: onHand,
        },
        {
          key: "scale",
          label: t("designEditor.tools.scale"),
          icon: <IconScale className="size-4" />,
          shortcut: MOVE_GROUP_TOOL_PRESENTATIONS.scale.shortcut,
          active: activeTool === "scale",
          onSelect: onScale,
        },
      ],
    };
  })();

  const frameGroup = buildToolVariantGroup<FrameGroupTool>({
    id: "frame",
    groupLabel: t("designEditor.tools.frame"),
    active: activeFrameTool,
    lastUsed: lastFrameTool,
    tools: [
      {
        key: "frame",
        label: t("designEditor.tools.frame"),
        shortcut: "F",
        icon: (className) => <IconFrame className={className} />,
        select: () => {
          onFrameToolDrawsChange("frame");
          onFrame();
        },
      },
      {
        key: "screen",
        label: t("designEditor.tools.screen"),
        icon: (className) => <IconDevices className={className} />,
        select: () => {
          onFrameToolDrawsChange("screen");
          onFrame();
        },
      },
    ],
  });

  const shapesGroup = ((): ToolbarGroup => {
    const shapeTool = (
      key: ShapeTool,
      icon: (className: string) => ReactNode,
      binding?: string,
    ): ToolDescriptor<ShapeTool> => ({
      key,
      label: t(`designEditor.tools.${key}`),
      shortcut: binding ? shortcut(binding) : undefined,
      icon,
      select: () => onShape(key),
    });
    return buildToolVariantGroup<ShapeTool>({
      id: "shapes",
      groupLabel: t("designEditor.tools.shapes"),
      active: activeShapeTool,
      lastUsed: lastShapeTool,
      tools: [
        shapeTool(
          "rect",
          (className) => <IconSquare className={className} />,
          "r",
        ),
        shapeTool(
          "line",
          (className) => <IconLine className={className} />,
          "l",
        ),
        shapeTool(
          "arrow",
          (className) => <IconArrowRight className={className} />,
          "shift+l",
        ),
        shapeTool(
          "ellipse",
          (className) => <IconOval className={className} />,
          "o",
        ),
        shapeTool("polygon", (className) => (
          <IconHexagon className={className} />
        )),
        shapeTool("star", (className) => <IconStar className={className} />),
      ],
      extraOptions: [
        {
          key: "image-video",
          label: t("designEditor.tools.imageVideo"),
          icon: <IconPhotoVideo className="size-4" />,
          shortcut: shortcut("$mod+shift+k"),
          dimmed: !canUploadMedia,
          separatorBefore: true,
          onSelect: () => {
            if (canUploadMedia) mediaInputRef.current?.click();
            else setStorageSetupOpen(true);
          },
        },
      ],
    });
  })();

  const textGroup: ToolbarGroup = {
    id: "text",
    active: activeTool === "text",
    label: t("designEditor.tools.text"),
    groupLabel: t("designEditor.tools.text"),
    icon: <IconText className="size-4" />,
    primaryShortcut: "T",
    onClick: onText,
    options: [],
  };

  const penGroup = buildToolVariantGroup<PenGroupTool>({
    id: "pen",
    groupLabel: t("designEditor.tools.pen"),
    active: activePenTool,
    lastUsed: lastPenTool,
    tools: [
      {
        key: "pen",
        label: t("designEditor.tools.pen"),
        shortcut: "P",
        icon: (className) => <DesignPenToolIcon className={className} />,
        select: onPen,
      },
      ...(annotateAvailable
        ? [
            {
              key: "draw" as const,
              label: t("designEditor.modes.draw"),
              shortcut: shortcut("shift+y"),
              disabled: !hasActiveFile,
              icon: (className: string) => <IconBrush className={className} />,
              select: onDraw,
            },
          ]
        : []),
    ],
  });

  const commentGroup: ToolbarGroup = {
    id: "comment",
    active: activeTool === "comment" && mode === "annotate" && pinMode,
    label: t("designEditor.pinComment"),
    groupLabel: t("designEditor.pinComment"),
    icon: <IconMessage className="size-4" />,
    primaryShortcut: "C",
    onClick: onCommentPin,
    options: [],
  };

  const groupsById: Record<ToolbarGroupId, ToolbarGroup> = {
    move: moveGroup,
    frame: frameGroup,
    shapes: shapesGroup,
    text: textGroup,
    pen: penGroup,
    comment: commentGroup,
  };
  const groups = getToolbarGroups(mode, { canComment }).map(
    (id) => groupsById[id],
  );

  const modes: Array<{
    key: EditorMode;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    ...(annotateAvailable
      ? [
          {
            key: "annotate" as const,
            active: mode === "annotate",
            label: t("designEditor.modes.annotate"),
            icon: <IconScribble className="size-[18px]" />,
            onClick: () => onModeChange("annotate"),
          },
        ]
      : []),
    {
      key: "edit",
      active: mode === "edit",
      label: t("designEditor.modes.edit"),
      icon: <IconTransformPoint className="size-[18px]" />,
      onClick: () => onModeChange("edit"),
    },
    {
      key: "interact",
      active: mode === "interact",
      label: t("designEditor.modes.interact"),
      icon: <IconHandClick className="size-[18px]" />,
      onClick: () => onModeChange("interact"),
    },
  ];
  if (groups.length === 0 && !showModeTabs) return null;
  return (
    <div
      data-design-bottom-toolbar
      data-design-toolbar-mode={mode === "interact" ? "interact" : "design"}
      /* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */
      className="fixed bottom-4 left-1/2 z-[70] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl overscroll-x-contain bg-[var(--design-editor-dock-bg)] p-2 text-white shadow-[0_4px_8px_rgba(0,0,0,0.18)] md:max-w-[calc(100%-2rem)] md:overflow-visible"
    >
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        disabled={!canUploadMedia}
        onChange={(event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);
          input.value = "";
          if (files.length > 0) onMediaFiles(files);
        }}
      />
      {groups.map((group) => (
        <DesignToolbarTool
          key={group.id}
          groupId={group.id}
          active={group.active}
          label={group.label}
          icon={group.icon}
          optionsLabel={optionsLabel(group.groupLabel)}
          options={group.options}
          onPrimary={group.onClick}
          primaryShortcut={group.primaryShortcut}
        />
      ))}
      <FileStorageSetupPopover
        open={
          storageSetupOpen && (fileStorageMissing || fileStorageUnavailable)
        }
        onOpenChange={setStorageSetupOpen}
        {...(fileStorageUnavailable
          ? {
              status: "unavailable" as const,
              onRetry: () => void fileUploadStatus.refetch(),
            }
          : { status: "missing" as const })}
      />

      {showModeTabs ? (
        <>
          {groups.length > 0 ? (
            /* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */
            <div className="mx-1 h-8 w-px shrink-0 bg-white/15" />
          ) : null}

          {/* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-white/10 p-0.5">
            {modes.map((item) => (
              <DesignModeTab
                key={item.key}
                active={item.active}
                label={item.label}
                icon={item.icon}
                onClick={item.onClick}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
