import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const toastWidthClasses =
  "group-[.toaster]:!w-[var(--width)] group-[.toaster]:!min-w-[min(20rem,calc(100vw_-_2rem))] group-[.toaster]:!max-w-[var(--width)] group-[.toaster]:!gap-3 group-[.toaster]:!break-normal";
const toastContentClasses =
  "group-[.toast]:!min-w-[min(16rem,calc(100vw_-_14rem))] group-[.toast]:!flex-1 group-[.toast]:!basis-auto group-[.toast]:break-words";
const toastButtonClasses =
  "group-[.toast]:!shrink-0 group-[.toast]:!whitespace-nowrap";

const Toaster = ({ className, toastOptions, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const classNames = toastOptions?.classNames;

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className={cn(
        "toaster group [--width:min(36rem,calc(100vw_-_2rem))]",
        className,
      )}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...classNames,
          toast: cn(
            toastWidthClasses,
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            classNames?.toast,
          ),
          title: cn("group-[.toast]:break-words", classNames?.title),
          description: cn(
            "group-[.toast]:break-words group-[.toast]:text-muted-foreground",
            classNames?.description,
          ),
          content: cn(toastContentClasses, classNames?.content),
          actionButton: cn(
            toastButtonClasses,
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            classNames?.actionButton,
          ),
          cancelButton: cn(
            toastButtonClasses,
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
            classNames?.cancelButton,
          ),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
