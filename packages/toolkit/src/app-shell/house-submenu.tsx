import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { IconChevronRight } from "@tabler/icons-react";
import {
  cloneElement,
  Children,
  Fragment,
  isValidElement,
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "../utils.js";

type SubmenuChild = ReactElement;
const withChevron = (child: SubmenuChild) => {
  if (
    !isValidElement<{ children?: ReactNode }>(child) ||
    child.type === Fragment
  )
    throw new Error("Shell submenu trigger requires one generated control");
  return cloneElement(child, {
    children: [
      ...Children.toArray(child.props.children),
      <IconChevronRight
        key="submenu-chevron"
        aria-hidden="true"
        className="ms-auto size-4 shrink-0 rtl:-scale-x-100"
      />,
    ],
  });
};

const style = (inset?: boolean, className?: string) =>
  cn(
    "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
    inset && "ps-9",
    className,
  );

/** The chevron belongs inside the one generated control, before Radix slots it. */
export const ShellDropdownSubTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  Omit<
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>,
    "asChild" | "children"
  > & { children: SubmenuChild; inset?: boolean }
>(({ children, inset, className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    {...props}
    ref={ref}
    asChild
    className={style(inset, className)}
  >
    {withChevron(children)}
  </DropdownMenuPrimitive.SubTrigger>
));
ShellDropdownSubTrigger.displayName = "ShellDropdownSubTrigger";

export const ShellContextSubTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  Omit<
    ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>,
    "asChild" | "children"
  > & { children: SubmenuChild; inset?: boolean }
>(({ children, inset, className, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    {...props}
    ref={ref}
    asChild
    className={style(inset, className)}
  >
    {withChevron(children)}
  </ContextMenuPrimitive.SubTrigger>
));
ShellContextSubTrigger.displayName = "ShellContextSubTrigger";
