import { useEffect, useRef, useState } from "react";
import { Treemap } from "recharts";

import type { ContextManifestSegment } from "../../shared/context-xray.js";
import { formatTokens, groupFill } from "./format.js";

interface TreemapDatum {
  name: string;
  size: number;
  group: string;
  segmentId: string;
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, group, size } = props;
  if (width < 8 || height < 8) return null;
  const showLabel = width > 90 && height > 42;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        ry={3}
        fill={groupFill(group)}
        stroke="var(--background)"
        strokeWidth={2}
      />
      {showLabel && (
        <foreignObject
          x={x + 6}
          y={y + 6}
          width={width - 12}
          height={height - 12}
        >
          <div className="flex h-full flex-col justify-between overflow-hidden text-[11px] leading-tight text-white">
            <div className="truncate font-medium">{name}</div>
            <div className="text-white/85">{formatTokens(size)}</div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

export function ContextTreemap({
  segments,
  onSelect,
}: {
  segments: ContextManifestSegment[];
  onSelect?: (segmentId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const data: TreemapDatum[] = segments
    .filter((segment) => segment.status !== "evicted" && segment.tokenCount > 0)
    .map((segment) => ({
      name: segment.label,
      size: segment.tokenCount,
      group: segment.group,
      segmentId: segment.segmentId,
    }));

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      setChartWidth(Math.max(0, Math.floor(element.clientWidth - 8)));
    };
    updateWidth();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateWidth)
        : null;
    observer?.observe(element);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground">
        No active segments
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-56 min-w-0 rounded-md bg-muted/25 p-1">
      {chartWidth > 0 && (
        <Treemap
          width={chartWidth}
          height={216}
          data={data as any}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={<TreemapContent />}
          onClick={(datum: any) => {
            if (datum?.segmentId) onSelect?.(datum.segmentId);
          }}
        />
      )}
    </div>
  );
}
