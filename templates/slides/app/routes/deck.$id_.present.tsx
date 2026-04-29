import Presentation from "@/pages/Presentation";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Presentation" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

export default function PresentationRoute() {
  return <Presentation />;
}
