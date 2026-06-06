import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  IconExternalLink,
  IconMessageCircle,
  IconMoon,
  IconPencil,
  IconSun,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlanPrototype } from "@shared/plan-content";
import { Wireframe } from "./wireframe/Wireframe";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "./wireframe/use-wireframe-style";

type PrototypeViewerProps = {
  prototype: PlanPrototype;
  commentsVisible?: boolean;
  onToggleComments?: () => void;
  disableScreenClicks?: boolean;
  standalone?: boolean;
  className?: string;
};

export function PrototypeViewer({
  prototype,
  commentsVisible = false,
  onToggleComments,
  disableScreenClicks = false,
  standalone = false,
  className,
}: PrototypeViewerProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const wireframeStyle = useWireframeStyle();
  const screenById = useMemo(
    () => new Map(prototype.screens.map((screen) => [screen.id, screen])),
    [prototype.screens],
  );
  const firstScreen = prototype.screens[0];
  const [activeScreenId, setActiveScreenId] = useState(
    prototype.initialScreenId ?? firstScreen?.id,
  );
  useEffect(() => {
    const preferred = prototype.initialScreenId ?? prototype.screens[0]?.id;
    setActiveScreenId((current) =>
      current && screenById.has(current) ? current : preferred,
    );
  }, [prototype.initialScreenId, prototype.screens, screenById]);

  const activeScreen =
    (activeScreenId ? screenById.get(activeScreenId) : undefined) ??
    firstScreen;
  const goToScreen = useCallback(
    (screenId: string) => {
      if (!screenById.has(screenId)) return;
      setActiveScreenId(screenId);
    },
    [screenById],
  );
  const openPopout = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (standalone) {
      url.searchParams.delete("prototype");
    } else {
      url.searchParams.set("prototype", "1");
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }, [standalone]);

  if (!activeScreen) return null;

  const themeIsDark = resolvedTheme === "dark";
  const wireframeData = {
    surface: activeScreen.surface ?? prototype.surface ?? "browser",
    html: activeScreen.html,
    caption: activeScreen.summary,
  };

  return (
    <section
      className={cn(
        "plan-prototype-viewer relative overflow-hidden border-b border-plan-line bg-plan-canvas",
        standalone ? "flex min-h-screen flex-col" : "min-h-[68vh]",
        className,
      )}
      data-plan-prototype-viewer
      aria-label="Prototype viewer"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--plan-grid-line)_1px,transparent_1px),linear-gradient(90deg,var(--plan-grid-line)_1px,transparent_1px)] bg-[length:28px_28px]" />

      <div
        className="pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-plan-line bg-plan-chrome/88 p-1 shadow-xl backdrop-blur"
        data-plan-interactive
      >
        {onToggleComments && (
          <PrototypeToolbarButton
            label={commentsVisible ? "Hide comments" : "Show comments"}
            onClick={onToggleComments}
          >
            <IconMessageCircle
              className={cn("size-4", commentsVisible && "text-primary")}
            />
          </PrototypeToolbarButton>
        )}
        <PrototypeToolbarButton
          label={
            wireframeStyle === "sketchy"
              ? "Clean prototype"
              : "Sketchy prototype"
          }
          onClick={toggleWireframeStyle}
        >
          <IconPencil className="size-4" />
        </PrototypeToolbarButton>
        <PrototypeToolbarButton
          label={themeIsDark ? "Light mode" : "Dark mode"}
          onClick={() => setTheme(themeIsDark ? "light" : "dark")}
        >
          {themeIsDark ? (
            <IconSun className="size-4" />
          ) : (
            <IconMoon className="size-4" />
          )}
        </PrototypeToolbarButton>
        <PrototypeToolbarButton
          label={standalone ? "Open full plan" : "Open prototype window"}
          onClick={openPopout}
        >
          <IconExternalLink className="size-4" />
        </PrototypeToolbarButton>
      </div>

      <div
        className={cn(
          "relative z-0 mx-auto flex w-full max-w-[1180px] justify-center px-6 pb-16 pt-20 sm:px-10",
          standalone && "flex-1 items-center",
        )}
        onClickCapture={(event) => {
          if (disableScreenClicks) return;
          const target = event.target as HTMLElement;
          const goto = target.closest<HTMLElement>("[data-goto]");
          const nextId = goto?.dataset.goto;
          if (!nextId) return;
          event.preventDefault();
          event.stopPropagation();
          goToScreen(nextId);
        }}
        data-prototype-screen={activeScreen.id}
      >
        <Wireframe data={wireframeData} interactive />
      </div>
    </section>
  );
}

function PrototypeToolbarButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
