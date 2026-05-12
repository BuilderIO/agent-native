interface IssueSparklineProps {
  data: number[][];
  escalating?: boolean;
}

export function IssueSparkline({ data, escalating }: IssueSparklineProps) {
  if (!data.length) return null;

  const values = data.map(([, v]) => v);
  const max = Math.max(...values, 1);
  const height = 24;
  const width = 120;
  const barW = Math.max(2, Math.floor(width / values.length) - 1);
  const gap = Math.max(1, Math.floor(width / values.length) - barW);

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      aria-hidden="true"
    >
      {values.map((v, i) => {
        const barH = Math.max(1, Math.round((v / max) * (height - 2)));
        const x = i * (barW + gap);
        const y = height - barH;
        const isRecent = i >= values.length - 4;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={1}
            className={
              escalating && isRecent
                ? "fill-rose-500/80"
                : "fill-muted-foreground/30"
            }
          />
        );
      })}
    </svg>
  );
}
