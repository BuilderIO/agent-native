import {
  type NotifyActionChangeOptions,
  writeActionChangeMarker,
} from "./action-change-marker-write.js";
import "./poll.js";

export { actionCallIsReadOnly } from "../action-call-classification.js";
export type { NotifyActionChangeOptions } from "./action-change-marker-write.js";

export async function notifyActionChange(
  options: NotifyActionChangeOptions,
): Promise<void> {
  await writeActionChangeMarker(options);
}

export function notifyActionChangeInBackground(
  options: NotifyActionChangeOptions,
): void {
  void writeActionChangeMarker(options).catch((error: unknown) => {
    console.warn(
      "[action-change] durable marker write failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
}
