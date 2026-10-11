import type { SVGProps } from "react";

export interface AgentMarkProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function AgentMark({ size = 24, className, ...props }: AgentMarkProps) {
  return (
    <svg
      data-agent-mark
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M18.4 5.2a9.15 9.15 0 1 0 1.8 2.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="18.55" cy="4.65" r="1.45" fill="currentColor" />
      <path
        d="m12 6.8 1.7 3.5 3.5 1.7-3.5 1.7-1.7 3.5-1.7-3.5-3.5-1.7 3.5-1.7L12 6.8Z"
        fill="currentColor"
      />
    </svg>
  );
}
