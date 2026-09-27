import type { SVGProps } from "react";

interface AgentNativeIconProps extends Omit<SVGProps<SVGSVGElement>, "fill"> {
  size?: number | string;
}

export function AgentNativeIcon({
  size = 24,
  className,
  ...rest
}: AgentNativeIconProps) {
  return (
    <svg
      data-agent-native-icon
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 114 66"
      fill="none"
      className={className}
      {...rest}
    >
      <path
        d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z"
        fill="currentColor"
      />
      <path
        d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z"
        fill="currentColor"
      />
    </svg>
  );
}
