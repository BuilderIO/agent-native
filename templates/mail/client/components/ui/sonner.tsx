import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[hsl(220,6%,22%)] group-[.toaster]:text-[hsl(220,10%,75%)] group-[.toaster]:border-[hsl(220,6%,28%)] group-[.toaster]:shadow-2xl group-[.toaster]:rounded-lg group-[.toaster]:text-[13px] group-[.toaster]:font-medium group-[.toaster]:px-4 group-[.toaster]:py-3",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:!bg-transparent group-[.toast]:!text-[hsl(210,80%,65%)] group-[.toast]:!text-[13px] group-[.toast]:!font-bold group-[.toast]:!tracking-wide group-[.toast]:!px-0 group-[.toast]:!ml-4 group-[.toast]:hover:!text-[hsl(210,80%,75%)]",
          cancelButton:
            "group-[.toast]:!bg-transparent group-[.toast]:!text-[hsl(220,10%,50%)] group-[.toast]:!text-[13px] group-[.toast]:!font-bold group-[.toast]:!tracking-wide group-[.toast]:!px-0 group-[.toast]:!ml-4 group-[.toast]:hover:!text-[hsl(220,10%,70%)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
