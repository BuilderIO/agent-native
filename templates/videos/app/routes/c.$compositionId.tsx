import Studio from "@/pages/Index";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Remotion Studio" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function CompositionRoute() {
  return <Studio />;
}
