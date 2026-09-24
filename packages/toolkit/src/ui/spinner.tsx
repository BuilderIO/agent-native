import { cn } from "../utils.js";
import { CubeLoader, type CubeLoaderProps } from "./cube-loader.js";

export function Spinner({ className, ...props }: CubeLoaderProps) {
  return <CubeLoader className={cn("size-4", className)} {...props} />;
}
