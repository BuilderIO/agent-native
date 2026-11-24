import { Toaster } from "@/components/ui/sonner";

declare function useT(): (key: string) => string;

export function AppToaster() {
  const t = useT();
  return <Toaster richColors position="bottom-right" visibleToasts={4} />;
}
