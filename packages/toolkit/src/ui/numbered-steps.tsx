import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";

import { cn } from "../utils.js";

export function NumberedSteps({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="numbered-steps"
      role="list"
      className={cn("my-6 list-none p-0", className)}
      {...props}
    />
  );
}

export function NumberedStep({
  number,
  last = false,
  showConnector = true,
  variant = "outline",
  contentClassName,
  className,
  children,
  ...props
}: ComponentProps<"li"> & {
  number: number;
  last?: boolean;
  showConnector?: boolean;
  variant?: "outline" | "secondary";
  contentClassName?: string;
}) {
  return (
    <li
      data-slot="numbered-step"
      className={cn("flex items-stretch gap-4", className)}
      {...props}
    >
      <div
        data-slot="numbered-step-aside"
        className={cn(
          "flex shrink-0 flex-col items-center",
          variant === "outline" && "pt-0.5",
        )}
        aria-hidden="true"
      >
        <span
          data-slot="numbered-step-indicator"
          className={cn(
            "relative z-10 flex size-[26px] shrink-0 items-center justify-center rounded-full text-xs font-semibold leading-none",
            variant === "secondary"
              ? "bg-secondary text-secondary-foreground"
              : "border-[1.5px] border-primary bg-background text-primary",
          )}
        >
          {number}
        </span>
        {!last && showConnector && (
          <span
            data-slot="numbered-step-connector"
            className="my-1.5 min-h-6 w-[1.5px] flex-1 bg-border"
          />
        )}
      </div>
      <div
        data-slot="numbered-step-content"
        className={cn("min-w-0 flex-1", !last && "pb-7", contentClassName)}
      >
        {children}
      </div>
    </li>
  );
}

export function NumberedStepTitle({
  asChild = false,
  className,
  ...props
}: ComponentProps<"h3"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "h3";
  return (
    <Comp
      data-slot="numbered-step-title"
      className={cn(
        "mt-0.5 mb-2 text-sm font-semibold leading-normal text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function NumberedStepBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="numbered-step-body"
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      {...props}
    />
  );
}
