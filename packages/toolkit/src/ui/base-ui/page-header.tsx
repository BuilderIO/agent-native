import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

export type PageHeaderProps = useRender.ComponentProps<"header">;

/**
 * The bar at the top of a canvas: whatever leads (a SidebarToggle, a back
 * button), the page's title, and its actions at the end. It holds a title and
 * actions only, never a subtitle or description under the title.
 *
 * @import import { PageHeader, PageHeaderTitle, PageHeaderActions } from "@agent-native/toolkit/ui/base-ui/page-header";
 */
function PageHeader({ render, ...props }: PageHeaderProps) {
  return useRender({
    defaultTagName: "header",
    render,
    props: mergeProps<"header">({ className: "page-header" }, props),
  });
}

export type PageHeaderTitleProps = useRender.ComponentProps<"h1">;

/**
 * The page's title, an `h1` by default.
 *
 * @import import { PageHeaderTitle } from "@agent-native/toolkit/ui/base-ui/page-header";
 */
function PageHeaderTitle({ render, ...props }: PageHeaderTitleProps) {
  return useRender({
    defaultTagName: "h1",
    render,
    props: mergeProps<"h1">({ className: "page-header-title" }, props),
  });
}

export type PageHeaderActionsProps = useRender.ComponentProps<"div">;

/**
 * The page's actions, at the end of the header.
 *
 * @import import { PageHeaderActions } from "@agent-native/toolkit/ui/base-ui/page-header";
 */
function PageHeaderActions({ render, ...props }: PageHeaderActionsProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "page-header-actions" }, props),
  });
}

export { PageHeader, PageHeaderTitle, PageHeaderActions };
