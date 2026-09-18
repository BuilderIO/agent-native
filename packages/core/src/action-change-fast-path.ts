import type { ActionChangeTarget } from "./action-change-marker.js";

type ActionChangeFastPath = (target: ActionChangeTarget) => void;

let publishFastPath: ActionChangeFastPath | undefined;

export function setActionChangeFastPath(publish: ActionChangeFastPath): void {
  publishFastPath = publish;
}

export function publishActionChangeFastPath(target: ActionChangeTarget): void {
  publishFastPath?.(target);
}
