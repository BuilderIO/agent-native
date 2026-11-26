import { Toaster } from "@/components/ui/sonner";

declare function useT(): (key: string) => string;

export function AppToaster() {
  const t = useT();
  return (
    <Toaster
      closeLabel={t("toast.close")}
      regionLabel={t("toast.region")}
      limit={4}
    />
  );
}
