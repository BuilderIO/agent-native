import AdhocRouter from "@/pages/adhoc/AdhocRouter";

export function meta() {
  return [{ title: "Dashboard — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function AdhocRoute() {
  return <AdhocRouter />;
}
