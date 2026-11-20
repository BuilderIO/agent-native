import { Spinner } from "@agent-native/toolkit/ui/spinner";

export function Waits() {
  return (
    <div>
      <Spinner />
      <Spinner className="size-3" aria-hidden />
      <Spinner className="mr-2 size-3.5" aria-label="Saving" />
      <Spinner className="h-5 w-5 text-muted-foreground" title="Loading designs" />
      <Spinner size={20} aria-hidden="true" />
      <Spinner className="size-4 shrink-0" aria-hidden />
    </div>
  );
}
