import { overviewFocusNavigationIndex } from "@shared/overview-navigation";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { OpenSlidePresenterLabels } from "./OpenSlidePlayer";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: number;
  total: number;
  onSelect: (index: number) => void;
  renderSlide?: (index: number) => ReactNode;
  labels: OpenSlidePresenterLabels;
  container: HTMLElement | null;
};

export default function OpenSlideOverview({
  open,
  onOpenChange,
  index,
  total,
  onSelect,
  renderSlide,
  labels,
  container,
}: Props) {
  const [focusedIndex, setFocusedIndex] = useState(index);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusedButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setFocusedIndex(index);
  }, [index, open]);

  useEffect(() => {
    if (!open) return;
    const button = focusedButtonRef.current;
    button?.focus();
    button?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [focusedIndex, open]);

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !(event.target instanceof HTMLElement)
    ) {
      return;
    }
    const tile = event.target.closest<HTMLElement>(
      "[data-slide-overview-index]",
    );
    const currentIndex = Number(tile?.dataset.slideOverviewIndex);
    if (!Number.isInteger(currentIndex)) return;

    const grid = gridRef.current;
    const columns = grid
      ? Math.max(
          1,
          getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean)
            .length,
        )
      : 1;
    const nextIndex = overviewFocusNavigationIndex(
      currentIndex,
      total,
      event.key,
      columns,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    setFocusedIndex(nextIndex);
    window.requestAnimationFrame(() => {
      const button = gridRef.current?.querySelector<HTMLButtonElement>(
        `[data-slide-overview-index="${nextIndex}"]`,
      );
      button?.focus();
      button?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container ?? undefined}
        closeLabel={labels.close}
        className="max-h-[min(90vh,900px)] max-w-6xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{labels.overviewTitle}</DialogTitle>
        </DialogHeader>
        <div
          ref={gridRef}
          onKeyDown={handleGridKeyDown}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {Array.from({ length: total }, (_, slideIndex) => (
            <button
              type="button"
              key={slideIndex}
              ref={slideIndex === focusedIndex ? focusedButtonRef : undefined}
              data-slide-overview-index={slideIndex}
              aria-label={labels.slideLabel(slideIndex + 1, total)}
              aria-current={slideIndex === index ? "true" : undefined}
              onFocus={() => setFocusedIndex(slideIndex)}
              onClick={() => onSelect(slideIndex)}
              className={cn(
                "group flex min-w-0 flex-col gap-1.5 rounded-md p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                slideIndex === focusedIndex && "bg-accent ring-2 ring-primary",
                slideIndex === index &&
                  slideIndex !== focusedIndex &&
                  "bg-accent",
              )}
            >
              <div className="relative block aspect-video w-full overflow-hidden rounded border border-border bg-muted">
                {renderSlide ? (
                  renderSlide(slideIndex)
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-2xl font-semibold text-muted-foreground">
                    {slideIndex + 1}
                  </span>
                )}
              </div>
              <span className="px-1 text-xs text-muted-foreground">
                {labels.slideLabel(slideIndex + 1, total)}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
