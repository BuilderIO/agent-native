import { Spinner } from "@agent-native/toolkit/ui/spinner";

const ICON = "size-4";

export function Blocked() {
  return (
    <div>
      <Spinner className={ICON} />
      <Spinner className="size-8" />
      <Spinner strokeWidth={3} />
    </div>
  );
}
