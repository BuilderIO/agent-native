import {
  MessageScroller as ShadcnMessageScroller,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
  type MessageScrollerDefaultScrollPosition,
  type MessageScrollerScrollAlign,
  type MessageScrollerScrollOptions,
  type MessageScrollerScrollable,
  type MessageScrollerVisibilityState,
} from "@shadcn/react/message-scroller";
import { IconChevronDown } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../../utils.js";

type MessageScrollerProviderProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Provider
>;
type MessageScrollerRootProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Root
>;
type MessageScrollerViewportProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Viewport
>;
type MessageScrollerContentProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Content
>;
type MessageScrollerItemProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Item
>;
type MessageScrollerButtonProps = React.ComponentProps<
  typeof ShadcnMessageScroller.Button
>;

function MessageScrollerProvider(props: MessageScrollerProviderProps) {
  return <ShadcnMessageScroller.Provider {...props} />;
}

function MessageScroller({ className, ...props }: MessageScrollerRootProps) {
  return (
    <ShadcnMessageScroller.Root
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  children,
  ...props
}: MessageScrollerViewportProps) {
  const { start: hasContentAbove } = useMessageScrollerScrollable();

  return (
    <ShadcnMessageScroller.Viewport
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
        // The base class carries the mask itself so it is never added or
        // removed; the modifier only widens the fade. See agent-native.css.
        "message-scroller-viewport",
        hasContentAbove && "message-scroller-viewport--top-fade",
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnMessageScroller.Viewport>
  );
}

function MessageScrollerContent({
  className,
  spacerClassName,
  ...props
}: MessageScrollerContentProps) {
  return (
    <ShadcnMessageScroller.Content
      className={cn("flex flex-col", className)}
      spacerClassName={cn("shrink-0", spacerClassName)}
      {...props}
    />
  );
}

function MessageScrollerItem(props: MessageScrollerItemProps) {
  return <ShadcnMessageScroller.Item {...props} />;
}

function MessageScrollerButton({
  className,
  children,
  render,
  ...props
}: MessageScrollerButtonProps) {
  return (
    <ShadcnMessageScroller.Button
      render={
        render ??
        ((buttonProps) => (
          // Overlaid, not in normal flow. As a flex sibling of the viewport
          // this button's own 28px took height away from the viewport when it
          // appeared and gave it back when it hid — and whether it appears is
          // derived from scroll position, so showing it could scroll the
          // content enough to hide it, which gave it back the space, which
          // showed it again. That loop is the scroll jumping up and down while
          // text streams. Positioning it over the viewport breaks the cycle.
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
            <button
              {...buttonProps}
              className={cn(
                "pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-accent",
                "data-[active=false]:hidden",
                className,
                buttonProps.className as string | undefined,
              )}
              aria-label="Scroll to bottom"
            >
              {children ?? (
                <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        ))
      }
      {...props}
    />
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
  type MessageScrollerDefaultScrollPosition,
  type MessageScrollerScrollAlign,
  type MessageScrollerScrollOptions,
  type MessageScrollerScrollable,
  type MessageScrollerVisibilityState,
};
