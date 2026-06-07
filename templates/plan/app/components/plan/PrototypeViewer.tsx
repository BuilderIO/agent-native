import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { PlanPrototype } from "@shared/plan-content";
import { Wireframe } from "./wireframe/Wireframe";

type PrototypeViewerProps = {
  prototype: PlanPrototype;
  disableScreenClicks?: boolean;
  standalone?: boolean;
  className?: string;
};

export function PrototypeViewer({
  prototype,
  disableScreenClicks = false,
  standalone = false,
  className,
}: PrototypeViewerProps) {
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
  if (!activeScreen) return null;

  const wireframeData = {
    surface: activeScreen.surface ?? prototype.surface ?? "browser",
    renderMode: activeScreen.renderMode,
    html: activeScreen.html,
    css: activeScreen.css,
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
