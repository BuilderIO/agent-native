import { cn } from "../utils.js";

const CUBE_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270];

export type SpinnerProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string;
};

export function Spinner({
  className,
  size,
  width,
  height,
  ...props
}: SpinnerProps) {
  const hasAriaLabel = Object.prototype.hasOwnProperty.call(
    props,
    "aria-label",
  );

  return (
    <svg
      {...props}
      role={props.role ?? "status"}
      aria-label={hasAriaLabel ? props["aria-label"] : "Loading"}
      width={width ?? size ?? 24}
      height={height ?? size ?? 24}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("size-4", className)}
      data-agent-native-spinner="true"
    >
      <style>{`
        @keyframes an-cube-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.95; }
        }
        .an-cube-cell {
          animation: an-cube-pulse 650ms ease-in-out infinite;
          fill: currentColor;
          opacity: 0.15;
        }
        @media (prefers-reduced-motion: reduce) {
          .an-cube-cell { animation: none; }
        }
      `}</style>
      {CUBE_DELAYS.map((delay, index) => (
        <rect
          key={index}
          className="an-cube-cell"
          x={1 + (index % 3) * 7}
          y={1 + Math.floor(index / 3) * 7}
          width={5}
          height={5}
          rx={1}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </svg>
  );
}
