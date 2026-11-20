import { Spinner } from "@agent-native/toolkit/ui/base-ui/spinner";

export function Waits() {
  return (
    <div>
      <Spinner />
      <Spinner size="1" />
      <Spinner className="mr-2" label="Saving" />
      <Spinner
        size="3"
        className="text-muted-foreground"
        label="Loading designs"
      />
      <Spinner size="3" />
      <Spinner className="shrink-0" />
    </div>
  );
}
