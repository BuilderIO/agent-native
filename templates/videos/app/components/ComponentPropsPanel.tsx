import { useT } from "@agent-native/core/client";
import {
  IconX,
  IconChevronRight,
  IconAdjustmentsHorizontal,
  IconFileText,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LibraryComponentEntry } from "@/remotion/componentRegistry";

type ComponentPropsPanelProps = {
  component: LibraryComponentEntry;
  onClose: () => void;
};

export function ComponentPropsPanel({
  component,
  onClose,
}: ComponentPropsPanelProps) {
  const t = useT();
  const [openSections, setOpenSections] = useState({
    props: true,
    animations: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="w-80 border-l border-border bg-secondary/30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t("editor.properties.title")}
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              className="p-1 hover:bg-secondary rounded transition-colors"
            >
              <IconX className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("editor.properties.closePanel")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Component Props Section */}
        <details open={openSections.props} className="border-b border-border">
          <summary
            className="px-4 py-3 cursor-pointer hover:bg-secondary/50 transition-colors flex items-center gap-2"
            onClick={(e) => {
              e.preventDefault();
              toggleSection("props");
            }}
          >
            <IconChevronRight
              className={cn(
                "w-4 h-4 transition-transform",
                openSections.props && "rotate-90",
              )}
            />
            <IconFileText className="w-4 h-4" />
            <span className="text-sm font-medium">
              {t("editor.properties.componentProps")}
            </span>
          </summary>

          {openSections.props && (
            <div className="px-4 py-3 space-y-4 bg-secondary/20">
              {component.propTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("editor.properties.noConfigurableProps")}
                </p>
              ) : (
                component.propTypes.map((prop) => (
                  <div key={prop.name} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="text-sm font-medium">{prop.name}</label>
                      <span className="text-xs text-muted-foreground font-mono">
                        {prop.type}
                      </span>
                    </div>

                    {prop.description && (
                      <p className="text-xs text-muted-foreground">
                        {prop.description}
                      </p>
                    )}

                    <div className="text-xs">
                      <span className="text-muted-foreground">
                        {t("editor.properties.defaultValue")}{" "}
                      </span>
                      <code className="px-1.5 py-0.5 bg-secondary rounded font-mono">
                        {typeof prop.defaultValue === "string"
                          ? `"${prop.defaultValue}"`
                          : String(prop.defaultValue)}
                      </code>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </details>

        {/* Animations Section */}
        <details
          open={openSections.animations}
          className="border-b border-border"
        >
          <summary
            className="px-4 py-3 cursor-pointer hover:bg-secondary/50 transition-colors flex items-center gap-2"
            onClick={(e) => {
              e.preventDefault();
              toggleSection("animations");
            }}
          >
            <IconChevronRight
              className={cn(
                "w-4 h-4 transition-transform",
                openSections.animations && "rotate-90",
              )}
            />
            <IconAdjustmentsHorizontal className="w-4 h-4" />
            <span className="text-sm font-medium">
              {t("editor.properties.animations")}
            </span>
          </summary>

          {openSections.animations && (
            <div className="px-4 py-3 space-y-3 bg-secondary/20">
              <p className="text-xs text-muted-foreground">
                {t("editor.properties.animationsDescription")}
              </p>

              <div className="space-y-2">
                <div className="text-xs">
                  <div className="font-medium mb-1">
                    {t("editor.properties.hoverAnimation")}
                  </div>
                  <div className="text-muted-foreground">
                    {t("editor.properties.hoverAnimationDescription")}
                  </div>
                </div>

                <div className="text-xs">
                  <div className="font-medium mb-1">
                    {t("editor.properties.clickAnimation")}
                  </div>
                  <div className="text-muted-foreground">
                    {t("editor.properties.clickAnimationDescription")}
                  </div>
                </div>
              </div>

              {component.tracks && component.tracks.length > 0 && (
                <div className="pt-3 border-t border-border">
                  <div className="text-xs font-medium mb-2">
                    {t("editor.properties.tracks")}
                  </div>
                  <div className="space-y-1.5">
                    {component.tracks.map((track) => (
                      <div
                        key={track.id}
                        className="px-2 py-1.5 bg-secondary/50 rounded text-xs"
                      >
                        <div className="font-medium">{track.label}</div>
                        <div className="text-muted-foreground">
                          {track.startFrame}f → {track.endFrame}f (
                          {track.easing})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </details>

        {/* Component Info */}
        <div className="px-4 py-3 space-y-3 text-xs text-muted-foreground">
          <div>
            <div className="font-medium text-foreground mb-1">
              {t("editor.properties.dimensions")}
            </div>
            <div>
              {component.width} × {component.height}px
            </div>
          </div>

          <div>
            <div className="font-medium text-foreground mb-1">
              {t("editor.properties.duration")}
            </div>
            <div>
              {component.durationInFrames} frames @ {component.fps}fps (
              {(component.durationInFrames / component.fps).toFixed(1)}s)
            </div>
          </div>

          <div>
            <div className="font-medium text-foreground mb-1">
              {t("editor.properties.componentId")}
            </div>
            <code className="px-1.5 py-0.5 bg-secondary rounded font-mono">
              {component.id}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
