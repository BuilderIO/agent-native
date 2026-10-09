import { useT } from "@agent-native/core/client/i18n";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import {
  IconArrowRight,
  IconBrush,
  IconBug,
  IconBulb,
  IconDevices,
  IconFrame,
  IconHandClick,
  IconHandStop,
  IconHexagon,
  IconLine,
  IconOval,
  IconPhotoVideo,
  IconPointer,
  IconScale,
  IconScribble,
  IconSparkles,
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
  AGENT_SKILLS,
  getActiveFrameGroupVariant,
  getToolbarGroups,
  type AgentSkillId,
  type FrameGroupVariant,
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

function agentSkillIcon(skill: AgentSkillId): ReactNode {
  switch (skill) {
    case "inspiration":
      return <IconBulb className="size-4" />;
    case "debug":
      return <IconBug className="size-4" />;
    case "polish":
      return <IconSparkles className="size-4" />;
  }
}

type FrameGroupDescriptor = {
  key: FrameGroupVariant;
  label: string;
  shortcut?: string;
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

export function DesignBottomToolbar({
  mode,
  activeTool,
  drawMode,
  hasActiveFile,
  frameToolDraws,
  onFrameToolDrawsChange,
  onMove,
  onInteractMove,
  onHand,
  onScale,
  onFrame,
  onText,
  onShape,
  onMediaFiles,
  onPen,
  onDraw,
  onAgentTool,
  onAgentSkill,
  onModeChange,
  showModeTabs,
  annotateEnabled,
}: {
  mode: EditorMode;
  activeTool: DesignTool;
  drawMode: boolean;
  hasActiveFile: boolean;
  frameToolDraws: "screen" | "frame";
  onFrameToolDrawsChange: (value: "screen" | "frame") => void;
  onMove: () => void;
  /** Move in Interact: take the pointer back from the Agent without leaving Interact. */
  onInteractMove: () => void;
  onHand: () => void;
  onScale: () => void;
  onFrame: () => void;
  onText: () => void;
  onShape: (tool: ShapeTool) => void;
  onMediaFiles: (files: File[]) => void;
  onPen: () => void;
  onDraw: () => void;
  onAgentTool: () => void;
  onAgentSkill: (skill: AgentSkillId) => void;
  onModeChange: (mode: EditorMode) => void;
  /**
   * The Interact / Design / Annotate switch lives in the editor top bar. Shells
   * that do not render that bar (minimal UI, embedded chrome, the visual-edit
   * route, hidden UI) still render this toolbar, so it carries the switch there.
   */
  showModeTabs: boolean;
  /** The Annotate lab: without it the Draw tool and the Annotate mode tab do not exist. */
  annotateEnabled: boolean;
}) {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus();
  const canUploadMedia =
    fileUploadStatus.isSuccess && fileUploadStatus.data.configured === true;
  const fileStorageMissing =
    fileUploadStatus.isSuccess && fileUploadStatus.data.configured === false;
  const fileStorageUnavailable = !fileUploadStatus.isSuccess;
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  const applePlatform = useApplePlatform();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const activeFrameVariant = getActiveFrameGroupVariant(
    activeTool,
    frameToolDraws,
  );
  // The Frame group's main button keeps the last variant armed, so a second
  // click draws another Rectangle rather than going back to a Frame.
  const [rememberedFrameVariant, setRememberedFrameVariant] =
    useState<FrameGroupVariant>(frameToolDraws);
  useEffect(() => {
    if (activeFrameVariant) setRememberedFrameVariant(activeFrameVariant);
  }, [activeFrameVariant]);
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
  const toOption = (
    descriptor: FrameGroupDescriptor,
    extra: Partial<DesignToolbarOption> = {},
  ): DesignToolbarOption => ({
    key: descriptor.key,
    label: descriptor.label,
    icon: descriptor.icon("size-4"),
    shortcut: descriptor.shortcut,
    active: descriptor.key === activeFrameVariant,
    onSelect: descriptor.select,
    ...extra,
  });

  const moveGroup = ((): ToolbarGroup => {
    const groupLabel = t("designEditor.tools.move");
    if (mode === "interact") {
      return {
        id: "move",
        active: activeTool !== "agent",
        label: groupLabel,
        groupLabel,
        icon: <IconPointer className="size-4" />,
        primaryShortcut: MOVE_GROUP_TOOL_PRESENTATIONS.move.shortcut,
        onClick: onInteractMove,
        options: [],
      };
    }
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

  const frameGroup = ((): ToolbarGroup => {
    const shapeDescriptor = (
      key: ShapeTool,
      icon: (className: string) => ReactNode,
      binding?: string,
    ): FrameGroupDescriptor => ({
      key,
      label: t(`designEditor.tools.${key}`),
      shortcut: binding ? shortcut(binding) : undefined,
      icon,
      select: () => onShape(key),
    });
    const frame: FrameGroupDescriptor = {
      key: "frame",
      label: t("designEditor.tools.frame"),
      shortcut: "F",
      icon: (className) => <IconFrame className={className} />,
      select: () => {
        onFrameToolDrawsChange("frame");
        onFrame();
      },
    };
    const text: FrameGroupDescriptor = {
      key: "text",
      label: t("designEditor.tools.text"),
      shortcut: "T",
      icon: (className) => <IconText className={className} />,
      select: onText,
    };
    const screen: FrameGroupDescriptor = {
      key: "screen",
      label: t("designEditor.tools.screen"),
      icon: (className) => <IconDevices className={className} />,
      select: () => {
        onFrameToolDrawsChange("screen");
        onFrame();
      },
    };
    const shapes: FrameGroupDescriptor[] = [
      shapeDescriptor(
        "rect",
        (className) => <IconSquare className={className} />,
        "r",
      ),
      shapeDescriptor(
        "line",
        (className) => <IconLine className={className} />,
        "l",
      ),
      shapeDescriptor(
        "arrow",
        (className) => <IconArrowRight className={className} />,
        "shift+l",
      ),
      shapeDescriptor(
        "ellipse",
        (className) => <IconOval className={className} />,
        "o",
      ),
      shapeDescriptor("polygon", (className) => (
        <IconHexagon className={className} />
      )),
      shapeDescriptor("star", (className) => (
        <IconStar className={className} />
      )),
    ];
    const armed = [frame, text, screen, ...shapes].find(
      (descriptor) =>
        descriptor.key === (activeFrameVariant ?? rememberedFrameVariant),
    )!;
    const imageVideo: DesignToolbarOption = {
      key: "image-video",
      label: t("designEditor.tools.imageVideo"),
      icon: <IconPhotoVideo className="size-4" />,
      shortcut: shortcut("$mod+shift+k"),
      dimmed: !canUploadMedia,
      onSelect: () => {
        if (canUploadMedia) mediaInputRef.current?.click();
        else setStorageSetupOpen(true);
      },
    };
    return {
      id: "frame",
      active: activeFrameVariant !== null,
      label: armed.label,
      groupLabel: t("designEditor.tools.frame"),
      icon: armed.icon("size-4"),
      primaryShortcut: armed.shortcut,
      onClick: armed.select,
      options: [
        toOption(frame),
        toOption(text),
        toOption(screen),
        imageVideo,
        ...shapes.map((shape, index) =>
          toOption(shape, { separatorBefore: index === 0 }),
        ),
      ],
    };
  })();

  const penGroup = ((): ToolbarGroup => {
    const drawActive =
      annotateEnabled &&
      activeTool === "draw" &&
      mode === "annotate" &&
      drawMode;
    const penOption: DesignToolbarOption = {
      key: "pen",
      label: t("designEditor.tools.pen"),
      icon: <DesignPenToolIcon className="size-4" />,
      shortcut: "P",
      active: activeTool === "pen",
      onSelect: onPen,
    };
    const drawOption: DesignToolbarOption = {
      key: "draw",
      label: t("designEditor.modes.draw"),
      icon: <IconBrush className="size-4" />,
      shortcut: shortcut("shift+y"),
      active: drawActive,
      disabled: !hasActiveFile,
      onSelect: onDraw,
    };
    return {
      id: "pen",
      active: activeTool === "pen" || drawActive,
      label: drawActive ? drawOption.label : penOption.label,
      groupLabel: t("designEditor.tools.pen"),
      icon: drawActive ? (
        <IconBrush className="size-4" />
      ) : (
        <DesignPenToolIcon className="size-4" />
      ),
      primaryShortcut: drawActive ? drawOption.shortcut : penOption.shortcut,
      onClick: drawActive ? onDraw : onPen,
      options: annotateEnabled ? [penOption, drawOption] : [penOption],
    };
  })();

  const agentGroup: ToolbarGroup = {
    id: "agent",
    active: activeTool === "agent",
    label: t("designEditor.tools.agent"),
    groupLabel: t("designEditor.tools.agent"),
    icon: <IconSparkles className="size-4" />,
    onClick: onAgentTool,
    options: AGENT_SKILLS.map((skill) => ({
      key: skill.id,
      label: t(skill.labelKey),
      icon: agentSkillIcon(skill.id),
      onSelect: () => onAgentSkill(skill.id),
    })),
  };

  const groupsById: Record<ToolbarGroupId, ToolbarGroup> = {
    move: moveGroup,
    frame: frameGroup,
    pen: penGroup,
    agent: agentGroup,
  };
  const groups = getToolbarGroups(mode).map((id) => groupsById[id]);

  const modes: Array<{
    key: EditorMode;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    ...(annotateEnabled
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
          {/* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */}
          <div className="mx-1 h-8 w-px shrink-0 bg-white/15" />

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
