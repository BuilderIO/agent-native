import { IconLoader2 } from "@tabler/icons-react";

import { cn } from "../utils.js";
import { CubeLoader } from "./cube-loader.js";

type SpinnerProps = React.ComponentProps<typeof IconLoader2> & {
  absoluteStrokeWidth?: boolean;
};

export function Spinner({
  className,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  stroke: _stroke,
  title: _title,
  ...props
}: SpinnerProps) {
  return <CubeLoader className={cn("size-4", className)} {...props} />;
}
