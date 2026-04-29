import About from "@/pages/About";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "About — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function AboutRoute() {
  return <About />;
}
