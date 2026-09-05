import { useCallback, useEffect, useRef } from "react";
import { toast, type ExternalToast } from "sonner";

type ToastId = string | number;
type LifecycleToastOptions = Pick<
  ExternalToast,
  "action" | "description" | "duration"
>;

/**
 * Keeps one in-flight operation in one Sonner instead of stacking a loading,
 * success, and error notification for the same work.
 */
export function useSonnerLifecycleToast() {
  const toastIdRef = useRef<ToastId | null>(null);

  const start = useCallback(
    (message: string, options?: LifecycleToastOptions) => {
      const nextOptions = {
        ...options,
        duration: Number.POSITIVE_INFINITY,
      };
      if (toastIdRef.current === null) {
        toastIdRef.current = toast.loading(message, nextOptions);
      } else {
        toast.loading(message, { ...nextOptions, id: toastIdRef.current });
      }
    },
    [],
  );

  const finish = useCallback(
    (
      kind: "error" | "info" | "success",
      message: string,
      options?: LifecycleToastOptions,
    ) => {
      const id = toastIdRef.current;
      const nextOptions = {
        ...options,
        duration: options?.duration ?? 6_000,
        ...(id === null ? {} : { id }),
      };
      toast[kind](message, nextOptions);
      toastIdRef.current = null;
    },
    [],
  );

  const success = useCallback(
    (message: string, options?: LifecycleToastOptions) =>
      finish("success", message, options),
    [finish],
  );
  const info = useCallback(
    (message: string, options?: LifecycleToastOptions) =>
      finish("info", message, options),
    [finish],
  );
  const error = useCallback(
    (message: string, options?: LifecycleToastOptions) =>
      finish("error", message, options),
    [finish],
  );
  const dismiss = useCallback(() => {
    if (toastIdRef.current === null) return;
    toast.dismiss(toastIdRef.current);
    toastIdRef.current = null;
  }, []);

  useEffect(() => dismiss, [dismiss]);

  return { dismiss, error, info, start, success };
}
