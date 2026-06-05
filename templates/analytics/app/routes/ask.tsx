import AskPage from "@/pages/Ask";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Ask — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function AskRoute() {
  return <AskPage />;
}
