import {
  type ProgressOwnProps,
  progressProps,
} from "@agent-native/design-system";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import * as React from "react";

import { partClassName } from "./part-class.js";
import { splitProps } from "./props.js";

export interface ProgressProps
  extends Omit<BaseProgress.Root.Props, "color">, ProgressOwnProps {
  /** A CSS duration, such as `"8s"`: an indeterminate bar fills over it. */
  duration?: string;
}

/**
 * A bar that shows a task moving toward done, or an indeterminate one that
 * fills over its duration. It is Base UI's Progress with Radix Themes' props;
 * unlike Radix Themes, a label and value sit above the track.
 *
 * @import import { Progress, ProgressLabel, ProgressValue } from "@agent-native/toolkit/ui/base-ui/progress";
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (props, ref) => {
    const [attributes, { className, children, ...rest }] = splitProps(
      progressProps,
      props,
    );
    const { duration } = props;
    const trackStyle: React.CSSProperties &
      Partial<Record<"--progress-duration", string>> =
      duration === undefined ? {} : { "--progress-duration": duration };
    return (
      <BaseProgress.Root
        ref={ref}
        {...rest}
        {...attributes}
        className={partClassName("progress", className)}
      >
        {children}
        <BaseProgress.Track className="progress-track" style={trackStyle}>
          <BaseProgress.Indicator className="progress-indicator" />
        </BaseProgress.Track>
      </BaseProgress.Root>
    );
  },
);
Progress.displayName = "Progress";

export type ProgressLabelProps = BaseProgress.Label.Props;

/**
 * The progress bar's name, shown above the track.
 *
 * @import import { ProgressLabel } from "@agent-native/toolkit/ui/base-ui/progress";
 */
const ProgressLabel = React.forwardRef<HTMLSpanElement, ProgressLabelProps>(
  ({ className, ...props }, ref) => (
    <BaseProgress.Label
      ref={ref}
      className={partClassName("progress-label", className)}
      {...props}
    />
  ),
);
ProgressLabel.displayName = "ProgressLabel";

export type ProgressValueProps = BaseProgress.Value.Props;

/**
 * The progress as formatted text, shown above the track.
 *
 * @import import { ProgressValue } from "@agent-native/toolkit/ui/base-ui/progress";
 */
const ProgressValue = React.forwardRef<HTMLSpanElement, ProgressValueProps>(
  ({ className, ...props }, ref) => (
    <BaseProgress.Value
      ref={ref}
      className={partClassName("progress-value", className)}
      {...props}
    />
  ),
);
ProgressValue.displayName = "ProgressValue";

export { Progress, ProgressLabel, ProgressValue };
