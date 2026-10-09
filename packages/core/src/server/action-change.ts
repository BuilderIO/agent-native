import {
  type NotifyActionChangeOptions,
  writeActionChangeMarker,
  writeActionChangeMarkerForResponse,
} from "./action-change-marker-write.js";
import "./poll.js";

export { actionCallIsReadOnly } from "../action-call-classification.js";
export type { NotifyActionChangeOptions } from "./action-change-marker-write.js";

export async function notifyActionChange(
  options: NotifyActionChangeOptions,
): Promise<void> {
  await writeActionChangeMarker(options);
}

export async function notifyActionChangeForResponse(
  options: NotifyActionChangeOptions,
): Promise<void> {
  await writeActionChangeMarkerForResponse(options);
}

export function notifyActionChangeInBackground(
  options: NotifyActionChangeOptions,
): void {
  void writeActionChangeMarkerForResponse(options);
}
