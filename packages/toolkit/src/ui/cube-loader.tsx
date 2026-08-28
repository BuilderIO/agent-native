import type { Ref } from "react";

import { cn } from "../utils.js";

const CUBE_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270];
const CUBE_ANIMATION_DURATION_MS = 650;

function setRef<Element>(ref: Ref<Element> | undefined, value: Element | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function setCubeAnimationPhase(
  svg: SVGSVGElement | null,
  ref?: Ref<SVGSVGElement>,
) {
  if (svg && typeof window !== "undefined") {
    svg.style.setProperty(
      "--an-cube-loader-phase",
      `${window.performance.now() % CUBE_ANIMATION_DURATION_MS}ms`,
    );
  }
  setRef(ref, svg);
}

export type CubeLoaderProps = Omit<
  React.SVGProps<SVGSVGElement>,
  "children"
> & {
  size?: number | string;
};

export function CubeLoader({
  className,
  size,
  width,
  height,
  ref,
  ...props
}: CubeLoaderProps) {
  const hasRole = Object.prototype.hasOwnProperty.call(props, "role");
  const hasExplicitSize =
    size !== undefined || width !== undefined || height !== undefined;
  const ariaLabel = props["aria-label"] ?? (hasRole ? undefined : "Loading");

  return (
    <svg
      {...props}
      ref={(svg) => setCubeAnimationPhase(svg, ref)}
      role={hasRole ? props.role : "status"}
      aria-label={ariaLabel}
      width={width ?? size ?? 24}
      height={height ?? size ?? 24}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn(!hasExplicitSize && "size-4", className)}
      data-agent-native-cube-loader="true"
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
          x={2.5 + (index % 3) * 7}
          y={2.5 + Math.floor(index / 3) * 7}
          width={5}
          height={5}
          rx={1}
          style={{
            animationDelay: `calc(${delay}ms - var(--an-cube-loader-phase, 0ms))`,
          }}
        />
      ))}
    </svg>
  );
}
