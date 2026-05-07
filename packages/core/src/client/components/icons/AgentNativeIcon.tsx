import type { SVGProps } from "react";

interface AgentNativeIconProps extends Omit<SVGProps<SVGSVGElement>, "fill"> {
  /**
   * Pixel size for the icon. Mirrors the Tabler icons API so this can be a
   * drop-in replacement for `<IconMessageDots size={16} />` etc. If you want
   * className-driven sizing instead (e.g. `w-4 h-4`), omit `size` — the SVG
   * will fill its container based on the className.
   */
  size?: number | string;
}

/**
 * Monochrome agent-native "A" mark. Source paths are taken from the Tauri
 * menu-bar icon at `packages/core/src/assets/branding/tray-icon.svg`, with the
 * padded tray viewBox cropped for toolbar use and `fill="white"` swapped for
 * `fill="currentColor"` so the icon inherits the surrounding text color.
 */
export function AgentNativeIcon({
  size = 24,
  className,
  ...rest
}: AgentNativeIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 114 114"
      fill="none"
      className={className}
      {...rest}
    >
      <g transform="translate(0 24)">
        <path
          d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z"
          fill="currentColor"
        />
        <path
          d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}
