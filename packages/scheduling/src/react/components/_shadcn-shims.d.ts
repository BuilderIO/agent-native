/**
 * Type shims for the consumer's shadcn/ui components.
 *
 * The scheduling package's React components import shadcn primitives via
 * the standard `@/components/ui/*` alias. That alias is resolved at
 * *build time* by the consumer's bundler (Vite / React Router) using the
 * template's `tsconfig.json` `paths` setting.
 *
 * The package itself doesn't have access to that alias during `tsc`
 * compilation, so we declare broad shapes here to make the compiler happy
 * without coupling the package to a specific shadcn version. Runtime
 * behaviour is driven entirely by the consumer's actual shadcn modules.
 *
 * Expected consumer primitives (add to your `app/components/ui/` folder
 * before importing any `@agent-native/scheduling/react/components` files):
 *
 *   - button    (Button)
 *   - input     (Input)
 *   - label     (Label)
 *   - textarea  (Textarea)
 *   - switch    (Switch)
 *   - badge     (Badge)
 *   - card      (Card, CardContent, CardDescription, CardHeader, CardTitle)
 *   - dialog    (Dialog, DialogContent, DialogHeader, DialogTitle,
 *                DialogDescription, DialogFooter, DialogTrigger)
 *   - select    (Select, SelectContent, SelectItem, SelectTrigger, SelectValue)
 *   - separator (Separator)
 *   - tabs      (Tabs, TabsList, TabsTrigger, TabsContent)
 *   - tooltip   (Tooltip, TooltipContent, TooltipTrigger)
 *   - dropdown-menu (DropdownMenu, DropdownMenuContent, DropdownMenuItem,
 *                    DropdownMenuSeparator, DropdownMenuTrigger)
 *   - alert-dialog (AlertDialog, AlertDialogAction, AlertDialogCancel,
 *                   AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
 *                   AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger)
 */
declare module "@/components/ui/button" {
  import type { ComponentType, ButtonHTMLAttributes, ReactNode } from "react";
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean;
    variant?:
      | "default"
      | "destructive"
      | "outline"
      | "secondary"
      | "ghost"
      | "link";
    size?: "default" | "sm" | "lg" | "icon";
    children?: ReactNode;
  }
  export const Button: ComponentType<ButtonProps>;
}

declare module "@/components/ui/input" {
  import type { ComponentType, InputHTMLAttributes } from "react";
  export const Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
}

declare module "@/components/ui/label" {
  import type { ComponentType, LabelHTMLAttributes, ReactNode } from "react";
  export const Label: ComponentType<
    LabelHTMLAttributes<HTMLLabelElement> & { children?: ReactNode }
  >;
}

declare module "@/components/ui/textarea" {
  import type { ComponentType, TextareaHTMLAttributes } from "react";
  export const Textarea: ComponentType<
    TextareaHTMLAttributes<HTMLTextAreaElement>
  >;
}

declare module "@/components/ui/switch" {
  import type { ComponentType } from "react";
  export const Switch: ComponentType<{
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
  }>;
}

declare module "@/components/ui/badge" {
  import type { ComponentType, HTMLAttributes, ReactNode } from "react";
  export const Badge: ComponentType<
    HTMLAttributes<HTMLDivElement> & {
      variant?: "default" | "secondary" | "outline" | "destructive";
      children?: ReactNode;
    }
  >;
}

declare module "@/components/ui/card" {
  import type { ComponentType, HTMLAttributes, ReactNode } from "react";
  type P = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  export const Card: ComponentType<P>;
  export const CardHeader: ComponentType<P>;
  export const CardTitle: ComponentType<P>;
  export const CardDescription: ComponentType<P>;
  export const CardContent: ComponentType<P>;
  export const CardFooter: ComponentType<P>;
}

declare module "@/components/ui/dialog" {
  import type { ComponentType, HTMLAttributes, ReactNode } from "react";
  type P = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  export const Dialog: ComponentType<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }>;
  export const DialogTrigger: ComponentType<{
    asChild?: boolean;
    children?: ReactNode;
  }>;
  export const DialogContent: ComponentType<P>;
  export const DialogHeader: ComponentType<P>;
  export const DialogTitle: ComponentType<P>;
  export const DialogDescription: ComponentType<P>;
  export const DialogFooter: ComponentType<P>;
}

declare module "@/components/ui/select" {
  import type { ComponentType, ReactNode } from "react";
  export const Select: ComponentType<{
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }>;
  export const SelectTrigger: ComponentType<{
    className?: string;
    children?: ReactNode;
  }>;
  export const SelectValue: ComponentType<{ placeholder?: string }>;
  export const SelectContent: ComponentType<{ children?: ReactNode }>;
  export const SelectItem: ComponentType<{
    value: string;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
  }>;
}

declare module "@/components/ui/separator" {
  import type { ComponentType } from "react";
  export const Separator: ComponentType<{
    className?: string;
    orientation?: "horizontal" | "vertical";
  }>;
}

declare module "@/components/ui/tabs" {
  import type { ComponentType, ReactNode } from "react";
  export const Tabs: ComponentType<{
    value?: string;
    defaultValue?: string;
    onValueChange?: (v: string) => void;
    className?: string;
    children?: ReactNode;
  }>;
  export const TabsList: ComponentType<{
    className?: string;
    children?: ReactNode;
  }>;
  export const TabsTrigger: ComponentType<{
    value: string;
    disabled?: boolean;
    children?: ReactNode;
  }>;
  export const TabsContent: ComponentType<{
    value: string;
    className?: string;
    children?: ReactNode;
  }>;
}

declare module "@/components/ui/tooltip" {
  import type { ComponentType, ReactNode } from "react";
  export const Tooltip: ComponentType<{ children?: ReactNode }>;
  export const TooltipTrigger: ComponentType<{
    asChild?: boolean;
    children?: ReactNode;
  }>;
  export const TooltipContent: ComponentType<{
    side?: "top" | "right" | "bottom" | "left";
    children?: ReactNode;
  }>;
  export const TooltipProvider: ComponentType<{ children?: ReactNode }>;
}

declare module "@/components/ui/dropdown-menu" {
  import type { ComponentType, ReactNode } from "react";
  export const DropdownMenu: ComponentType<{ children?: ReactNode }>;
  export const DropdownMenuTrigger: ComponentType<{
    asChild?: boolean;
    children?: ReactNode;
  }>;
  export const DropdownMenuContent: ComponentType<{
    align?: "start" | "center" | "end";
    children?: ReactNode;
  }>;
  export const DropdownMenuItem: ComponentType<{
    asChild?: boolean;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
    children?: ReactNode;
  }>;
  export const DropdownMenuSeparator: ComponentType;
}

declare module "@/components/ui/alert-dialog" {
  import type { ComponentType, ReactNode } from "react";
  export const AlertDialog: ComponentType<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }>;
  export const AlertDialogTrigger: ComponentType<{
    asChild?: boolean;
    children?: ReactNode;
  }>;
  export const AlertDialogContent: ComponentType<{ children?: ReactNode }>;
  export const AlertDialogHeader: ComponentType<{ children?: ReactNode }>;
  export const AlertDialogTitle: ComponentType<{ children?: ReactNode }>;
  export const AlertDialogDescription: ComponentType<{ children?: ReactNode }>;
  export const AlertDialogFooter: ComponentType<{ children?: ReactNode }>;
  export const AlertDialogAction: ComponentType<{
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    children?: ReactNode;
  }>;
  export const AlertDialogCancel: ComponentType<{ children?: ReactNode }>;
}

declare module "@/components/ui/popover" {
  import type { ComponentType, ReactNode } from "react";
  export const Popover: ComponentType<{
    open?: boolean;
    onOpenChange?: (o: boolean) => void;
    children?: ReactNode;
  }>;
  export const PopoverTrigger: ComponentType<{
    asChild?: boolean;
    children?: ReactNode;
  }>;
  export const PopoverContent: ComponentType<{
    align?: "start" | "center" | "end";
    className?: string;
    children?: ReactNode;
  }>;
}
