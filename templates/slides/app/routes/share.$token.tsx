import SharedPresentation from "@/pages/SharedPresentation";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Shared Presentation" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

export default function SharedPresentationRoute() {
  return <SharedPresentation />;
}
