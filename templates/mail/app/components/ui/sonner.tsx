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
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg group-[.toaster]:text-[13px] group-[.toaster]:font-medium group-[.toaster]:px-4 group-[.toaster]:py-3",
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
            "group-[.toast]:!bg-transparent group-[.toast]:!text-[hsl(210,80%,65%)] group-[.toast]:!text-[13px] group-[.toast]:!font-bold group-[.toast]:!tracking-normal group-[.toast]:!px-0 group-[.toast]:!ml-4 group-[.toast]:hover:!text-[hsl(210,80%,75%)]",
            classNames?.actionButton,
          ),
          cancelButton: cn(
            toastButtonClasses,
            "group-[.toast]:!bg-transparent group-[.toast]:!text-[hsl(220,10%,50%)] group-[.toast]:!text-[13px] group-[.toast]:!font-bold group-[.toast]:!tracking-normal group-[.toast]:!px-0 group-[.toast]:!ml-4 group-[.toast]:hover:!text-[hsl(220,10%,70%)]",
            classNames?.cancelButton,
          ),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
