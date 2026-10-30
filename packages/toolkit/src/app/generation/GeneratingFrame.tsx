import type { CSSProperties, ReactNode } from "react";

import { injectGenerationStyles } from "./generation-styles.js";

export type GeneratingFrameStatus = "pending" | "streaming" | "done" | "failed";

export interface GeneratingLabelProps {
  children: ReactNode;
  /** Runs the shimmer; off for a finished or failed label. */
  active?: boolean | undefined;
  icon?: ReactNode | undefined;
  className?: string | undefined;
}

/** A status line whose text shimmers while the agent works. */
export function GeneratingLabel({
  children,
  active = true,
  icon,
  className,
}: GeneratingLabelProps) {
  injectGenerationStyles();
  return (
    <span
      className={["an-generating-label", className].filter(Boolean).join(" ")}
      data-active={active ? "" : undefined}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span className="an-generating-label-text">{children}</span>
    </span>
  );
}

export interface GeneratingFrameProps {
  /**
   * `pending`: nothing has arrived, so the frame waits empty. `streaming`:
   * content is arriving. `done`: the real result is replacing the preview.
   * `failed`: the run stopped; the preview stays visible but is not a result.
   */
  status: GeneratingFrameStatus;
  /** The status line above the frame. */
  label?: ReactNode | undefined;
  labelIcon?: ReactNode | undefined;
  /** Names the frame for assistive tech when no visible label is shown. */
  ariaLabel?: string | undefined;
  /** The streaming preview. */
  children?: ReactNode | undefined;
  className?: string | undefined;
  surfaceClassName?: string | undefined;
  /** Size the surface, for example `{ aspectRatio: "16 / 9" }`. */
  surfaceStyle?: CSSProperties | undefined;
}

/**
 * Reserves the final size of something the agent is generating and outlines
 * it in the selection color while the content streams in, with a wash moving
 * over the label. It never fills the wait with placeholder art: an empty
 * frame at the right size is the honest state. Every app's generation
 * preview should go through this frame so the motion matches everywhere.
 */
export function GeneratingFrame({
  status,
  label,
  labelIcon,
  ariaLabel,
  children,
  className,
  surfaceClassName,
  surfaceStyle,
}: GeneratingFrameProps) {
  injectGenerationStyles();
  const working = status === "pending" || status === "streaming";
  const hasContent = children !== undefined && children !== null;
  return (
    <div
      className={["an-generating", className].filter(Boolean).join(" ")}
      data-status={status}
    >
      {label ? (
        <GeneratingLabel active={working} icon={labelIcon}>
          {label}
        </GeneratingLabel>
      ) : null}
      <div
        className={["an-generating-surface", surfaceClassName]
          .filter(Boolean)
          .join(" ")}
        style={surfaceStyle}
        aria-busy={working}
        aria-label={ariaLabel}
        role={ariaLabel ? "img" : undefined}
      >
        <div
          className="an-generating-layer"
          style={{ opacity: hasContent ? 1 : 0 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
