import { useEffect, useRef } from "react";

export function useNativeSceneExportAbort(ownerId: string | undefined) {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [ownerId]);
  return controller;
}
