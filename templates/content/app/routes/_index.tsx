import { AppLayout } from "@/components/layout/AppLayout";
import { EmptyState } from "@/components/EmptyState";

export function meta() {
  return [{ title: "Documents" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function IndexRoute() {
  return (
    <AppLayout activeDocumentId={null}>
      <EmptyState />
    </AppLayout>
  );
}
