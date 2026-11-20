import { buildTemplate, type TemplateId } from "@shared/form-templates";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormRunner } from "@/components/respond/FormRunner";
import { cn } from "@/lib/utils";

const SOURCE_WIDTH = 760;
const SOURCE_HEIGHT = 570;

/** Static, scaled-down first page of a template. Mounts the runner only once visible. */
export function TemplateThumbnail({
  id,
  className,
}: {
  id: TemplateId;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const resize = new ResizeObserver(() =>
      setScale(node.clientWidth / SOURCE_WIDTH),
    );
    resize.observe(node);
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        seen.disconnect();
      }
    });
    seen.observe(node);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, []);

  const blocks = useMemo(() => {
    if (!visible) return [];
    const all = buildTemplate(id);
    const end = all.findIndex((block) => block.type === "PAGE_BREAK");
    return end === -1 ? all : all.slice(0, end);
  }, [id, visible]);

  return (
    <div
      ref={frame}
      aria-hidden
      className={cn(
        "forms-template-thumbnail pointer-events-none relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted/40",
        className,
      )}
    >
      {visible ? (
        <div
          inert
          className="absolute top-0 left-0 origin-top-left [&>div]:!pt-0 [&>div]:!pb-0 [&_.forms-root]:!pt-10"
          style={{
            width: SOURCE_WIDTH,
            height: SOURCE_HEIGHT,
            transform: `scale(${scale})`,
          }}
        >
          <FormRunner mode="preview" blocks={blocks} />
        </div>
      ) : null}
    </div>
  );
}
