import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export function fitTemplateStage(width: number, height: number) {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(width / 960, height / 540);
  return { width: 960 * scale, height: 540 * scale };
}

export function DeckTemplateStage({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ReturnType<typeof fitTemplateStage>>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () =>
      setSize(fitTemplateStage(element.clientWidth, element.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={stage} className="deck-template-stage">
      <div
        className="deck-template-stage-canvas"
        style={
          size
            ? ({
                "--deck-template-stage-width": `${size.width}px`,
                "--deck-template-stage-height": `${size.height}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
