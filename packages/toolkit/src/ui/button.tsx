import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import {
  LegacyButtonRenderContext,
  useDesignSystemComponent,
} from "../design-system/context.js";
import { DesignSystemErrorBoundary } from "../design-system/error-boundary.js";
import type {
  DesignSystemEmphasis,
  DesignSystemIntent,
} from "../design-system/types.js";
import { useToolkitComponent } from "../provider.js";
import { cn } from "../utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform,scale] duration-150 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Semantic meaning forwarded to a registered design-system ActionButton. */
  intent?: DesignSystemIntent;
  /** Semantic prominence forwarded independently of the default visual variant. */
  emphasis?: DesignSystemEmphasis;
}

const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      intent: _intent,
      emphasis: _emphasis,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
ButtonBase.displayName = "ButtonBase";

const ButtonOverrideRenderContext = React.createContext(false);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, asChild = false, intent, emphasis, ...props }, ref) => {
    const DesignSystemActionButton = useDesignSystemComponent("ActionButton");
    const Override = useToolkitComponent("Button");
    const isRenderingOverride = React.useContext(ButtonOverrideRenderContext);
    const isRenderingLegacyButton = React.useContext(LegacyButtonRenderContext);
    const fallback = (
      <ButtonBase
        ref={ref}
        variant={variant}
        size={size}
        asChild={asChild}
        {...props}
      />
    );
    if (DesignSystemActionButton && !asChild && !isRenderingLegacyButton) {
      const semanticIntent =
        intent ??
        (variant === "destructive"
          ? "danger"
          : variant === "default"
            ? "primary"
            : "neutral");
      const semanticEmphasis =
        emphasis ??
        (variant === "outline"
          ? "outline"
          : variant === "ghost" || variant === "link"
            ? "ghost"
            : "solid");
      const semanticSize =
        size === "sm" ? "compact" : size === "lg" ? "large" : "default";
      return (
        <DesignSystemErrorBoundary component="ActionButton" fallback={fallback}>
          <DesignSystemActionButton
            className={props.className}
            style={props.style}
            id={props.id}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            aria-controls={props["aria-controls"]}
            elementRef={ref}
            type={props.type}
            disabled={props.disabled}
            intent={semanticIntent}
            emphasis={semanticEmphasis}
            size={semanticSize}
            onPress={(event) =>
              props.onClick?.(
                event as React.MouseEvent<HTMLButtonElement, MouseEvent>,
              )
            }
          >
            {props.children}
          </DesignSystemActionButton>
        </DesignSystemErrorBoundary>
      );
    }
    if (Override && Override !== Button && !isRenderingOverride) {
      const OverrideButton = Override as React.ElementType<ButtonProps>;
      return (
        <DesignSystemErrorBoundary component="ActionButton" fallback={fallback}>
          <ButtonOverrideRenderContext.Provider value={true}>
            <OverrideButton
              ref={ref}
              variant={variant}
              size={size}
              asChild={asChild}
              intent={intent}
              emphasis={emphasis}
              {...props}
            />
          </ButtonOverrideRenderContext.Provider>
        </DesignSystemErrorBoundary>
      );
    }

    return fallback;
  },
);
Button.displayName = "Button";

export { Button, ButtonBase, buttonVariants };
