import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconBrush,
  IconCircle,
  IconDevices,
  IconFrame,
  IconHandClick,
  IconHandStop,
  IconLine,
  IconMessage,
  IconPhotoVideo,
  IconPointer,
  IconScale,
  IconScribble,
  IconSquare,
  IconStar,
  IconTransformPoint,
  IconTriangle,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import type { DesignToolbarOption } from "@/components/design/editor/toolbar-controls";
import {
  DesignModeTab,
  DesignPenToolIcon,
  DesignToolbarTool,
} from "@/components/design/editor/toolbar-controls";
import { IconText } from "@/components/design/inspector/design-icons";
import {
  MOVE_GROUP_TOOL_PRESENTATIONS,
  getMoveGroupToolPresentation,
} from "@/pages/design-editor/tool-state";
import type {
  DesignTool,
  EditorMode,
  ShapeTool,
} from "@/pages/design-editor/types";

export function DesignBottomToolbar({
  mode,
  pinMode,
  drawMode,
  activeTool,
  isOverview,
  hasActiveFile,
  onMove,
  onFrame,
  frameToolDraws,
  onFrameToolDrawsChange,
  onShape,
  onText,
  onPen,
  onHand,
  onDraw,
  onScale,
  onCommentPin,
  onModeChange,
  shortcutsPanelOpen,
}: {
  mode: EditorMode;
  pinMode: boolean;
  drawMode: boolean;
  activeTool: DesignTool;
  isOverview: boolean;
  hasActiveFile: boolean;
  onMove: () => void;
  onFrame: () => void;
  frameToolDraws: "screen" | "frame";
  onFrameToolDrawsChange: (value: "screen" | "frame") => void;
  onShape: (tool: ShapeTool) => void;
  onText: () => void;
  onPen: () => void;
  onHand: () => void;
  onDraw: () => void;
  onScale: () => void;
  onCommentPin: () => void;
  onModeChange: (mode: EditorMode) => void;
  shortcutsPanelOpen: boolean;
}) {
  const t = useT();
  const shapeTools = new Set<DesignTool>([
    "rect",
    "line",
    "arrow",
    "ellipse",
    "polygon",
    "star",
  ]);
  const activeShape = shapeTools.has(activeTool)
    ? (activeTool as ShapeTool)
    : "rect";
  const shapeIcon = (tool: ShapeTool, className: string) => {
    switch (tool) {
      case "line":
        return <IconLine className={className} />;
      case "arrow":
        return <IconArrowUpRight className={className} />;
      case "ellipse":
        return <IconCircle className={className} />;
      case "polygon":
        return <IconTriangle className={className} />;
      case "star":
        return <IconStar className={className} />;
      case "rect":
      default:
        return <IconSquare className={className} />;
    }
  };
  const shapeOptions: DesignToolbarOption[] = [
    {
      key: "rect",
      label: t("designEditor.tools.rect"),
      icon: shapeIcon("rect", "size-4"),
      shortcut: "R",
      active: activeTool === "rect",
      onSelect: () => onShape("rect"),
    },
    {
      key: "line",
      label: t("designEditor.tools.line"),
      icon: shapeIcon("line", "size-4"),
      shortcut: "L",
      active: activeTool === "line",
      onSelect: () => onShape("line"),
    },
    {
      key: "arrow",
      label: t("designEditor.tools.arrow"),
      icon: shapeIcon("arrow", "size-4"),
      shortcut: "⇧L",
      active: activeTool === "arrow",
      onSelect: () => onShape("arrow"),
    },
    {
      key: "ellipse",
      label: t("designEditor.tools.ellipse"),
      icon: shapeIcon("ellipse", "size-4"),
      shortcut: "O",
      active: activeTool === "ellipse",
      onSelect: () => onShape("ellipse"),
    },
    {
      key: "polygon",
      label: t("designEditor.tools.polygon"),
      icon: shapeIcon("polygon", "size-4"),
      active: activeTool === "polygon",
      onSelect: () => onShape("polygon"),
    },
    {
      key: "star",
      label: t("designEditor.tools.star"),
      icon: shapeIcon("star", "size-4"),
      active: activeTool === "star",
      onSelect: () => onShape("star"),
    },
    {
      key: "image-video",
      label: t("designEditor.tools.imageVideo"),
      icon: <IconPhotoVideo className="size-4" />,
      disabled: true,
      onSelect: () => {},
    },
  ];
  const activeShapeOption =
    shapeOptions.find((option) => option.key === activeShape) ??
    shapeOptions[0]!;
  const activeMoveGroupTool = getMoveGroupToolPresentation(activeTool);
  const handleActiveMoveGroupTool =
    activeMoveGroupTool.tool === "hand"
      ? onHand
      : activeMoveGroupTool.tool === "scale"
        ? onScale
        : onMove;
  const tools: Array<{
    key: string;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    options: DesignToolbarOption[];
  }> = [
    {
      key: "move",
      // Parent button is active whenever any of the move-group sub-tools is
      // selected so the toolbar visually reflects hand and scale modes too.
      active:
        (activeTool === "move" && mode === "edit") ||
        activeTool === "hand" ||
        activeTool === "scale",
      // The parent button represents the active move-group sub-tool. Expose
      // that same identity to assistive technology and the tooltip instead of
      // announcing every H/K activation as the Move tool.
      label: t(activeMoveGroupTool.labelKey),
      // Mirror the active sub-tool icon so the parent button is always
      // informative about the currently selected move-group tool.
      icon:
        activeTool === "hand" ? (
          <IconHandStop className="size-[18px]" />
        ) : activeTool === "scale" ? (
          <IconScale className="size-[18px]" />
        ) : (
          <IconPointer className="size-[18px]" />
        ),
      // Keep the primary action aligned with the icon/label it presents. A
      // Hand or Scale button should remain Hand or Scale when clicked rather
      // than silently switching back to Move.
      onClick: handleActiveMoveGroupTool,
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
    },
    {
      key: "frame",
      active: activeTool === "frame",
      label:
        frameToolDraws === "screen"
          ? t("designEditor.tools.screen")
          : t("designEditor.tools.frame"),
      icon:
        frameToolDraws === "screen" ? (
          <IconDevices className="size-[18px]" />
        ) : (
          <IconFrame className="size-[18px]" />
        ),
      onClick: onFrame,
      options: [
        {
          key: "frame",
          label: t("designEditor.tools.frame"),
          icon: <IconFrame className="size-4" />,
          shortcut: "F",
          active: activeTool === "frame" && frameToolDraws === "frame",
          onSelect: () => {
            onFrameToolDrawsChange("frame");
            onFrame();
          },
        },
        {
          key: "screen",
          label: t("designEditor.tools.screen"),
          icon: <IconDevices className="size-4" />,
          active: activeTool === "frame" && frameToolDraws === "screen",
          onSelect: () => {
            onFrameToolDrawsChange("screen");
            onFrame();
          },
        },
      ],
    },
    {
      key: "shape",
      active: shapeTools.has(activeTool),
      label: activeShapeOption.label,
      icon: shapeIcon(activeShape, "size-[18px]"),
      onClick: () => onShape(activeShape),
      options: shapeOptions,
    },
    {
      key: "pen",
      active: activeTool === "pen",
      label: t("designEditor.tools.pen"),
      icon: <DesignPenToolIcon className="size-[18px]" />,
      onClick: onPen,
      options: [
        {
          key: "pen",
          label: t("designEditor.tools.pen"),
          icon: <DesignPenToolIcon className="size-4" />,
          shortcut: "P",
          active: activeTool === "pen",
          onSelect: onPen,
        },
        {
          key: "draw",
          label: t("designEditor.modes.draw"),
          icon: <IconBrush className="size-4" />,
          shortcut: "Y",
          active: activeTool === "draw" && mode === "annotate" && drawMode,
          disabled: !hasActiveFile,
          onSelect: onDraw,
        },
      ],
    },
    {
      key: "text",
      active: activeTool === "text",
      label: t("designEditor.tools.text"),
      icon: <IconText className="size-[18px]" />,
      onClick: onText,
      options: [
        {
          key: "text",
          label: t("designEditor.tools.text"),
          icon: <IconText className="size-4" />,
          shortcut: "T",
          active: activeTool === "text",
          onSelect: onText,
        },
      ],
    },
    {
      key: "comment",
      active: activeTool === "comment" && mode === "annotate" && pinMode,
      label: t("designEditor.pinComment"),
      icon: <IconMessage className="size-[18px]" />,
      onClick: onCommentPin,
      options: [
        {
          key: "comment",
          label: t("designEditor.pinComment"),
          icon: <IconMessage className="size-4" />,
          shortcut: "C",
          active: activeTool === "comment" && mode === "annotate" && pinMode,
          disabled: !hasActiveFile || isOverview,
          onSelect: onCommentPin,
        },
      ],
    },
  ];

  const modes: Array<{
    key: EditorMode;
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "annotate",
      active: mode === "annotate",
      label: t("designEditor.modes.annotate"),
      icon: <IconScribble className="size-[18px]" />,
      onClick: () => onModeChange("annotate"),
    },
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
      /* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */
      className="fixed left-1/2 z-[70] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-[#2c2c2c]/95 p-1.5 text-neutral-100 shadow-[0_22px_55px_-24px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.25)] backdrop-blur transition-[bottom] duration-150 motion-reduce:transition-none md:max-w-[calc(100%-2rem)] md:overflow-visible"
      style={{ bottom: shortcutsPanelOpen ? 257 : 16 }}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        {tools.map((tool) => (
          <DesignToolbarTool
            key={tool.key}
            active={tool.active}
            label={tool.label}
            icon={tool.icon}
            options={tool.options}
            onPrimary={tool.onClick}
          />
        ))}
      </div>

      {/* guard:allow-raw-color — fixed dark editor chrome, intentionally theme-independent */}
      <div className="h-9 w-px shrink-0 bg-white/15" />

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
    </div>
  );
}
