import { Spinner } from "@agent-native/toolkit/ui/base-ui/spinner";

export function Waits() {
  return (
    <div>
      <Spinner />
      <Spinner />
      <Spinner className="mr-2" label="Saving" />
      <Spinner className="text-muted-foreground" label="Loading designs" />
      <Spinner />
      <Spinner className="shrink-0" />
    </div>
  );
}
