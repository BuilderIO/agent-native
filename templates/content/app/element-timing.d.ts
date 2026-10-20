import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    /** Element Timing API identifier; see `lib/startup-timing.ts`. */
    elementtiming?: string;
  }
}
