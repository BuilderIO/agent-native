import {
  readClientAppState,
  useActionMutation,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

const IMAGE_MODEL_STATE_KEY = "imageGenerationModel";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const IMAGE_MODEL_OPTIONS = [
  {
    value: "gemini-3-pro-image",
    modelName: "Gemini 3 Pro",
    descriptorKey: "create.modelBestQuality",
  },
  {
    value: "gemini-3.1-flash-image",
    modelName: "Gemini 3.1 Flash",
    descriptorKey: "create.modelFast",
  },
  { value: "gemini-2.5-flash-image", modelName: "Gemini 2.5 Flash" },
  { value: "gpt-image-2", modelName: "GPT Image 2" },
] as const;

export function useImageModelMenu(threadId?: string | null) {
  const t = useT();
  const queryClient = useQueryClient();
  const dismissFailed = useActionMutation("dismiss-variant-slots");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL);

  useEffect(() => {
    let cancelled = false;
    void readClientAppState<{ model?: string }>(IMAGE_MODEL_STATE_KEY)
      .then((state) => {
        const stored = state?.model;
        if (
          !cancelled &&
          stored &&
          IMAGE_MODEL_OPTIONS.some((option) => option.value === stored)
        ) {
          setImageModel(stored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImageModelChange = useCallback(
    (value: string) => {
      setImageModel(value);
      void writeClientAppState(IMAGE_MODEL_STATE_KEY, { model: value }).catch(
        () => {},
      );
      if (threadId) {
        dismissFailed.mutate(
          { scope: "failed", threadId },
          {
            onSuccess: () =>
              void queryClient.invalidateQueries({ queryKey: ["app-state"] }),
          },
        );
      }
    },
    [dismissFailed, queryClient, threadId],
  );

  return useMemo(
    () => ({
      value: imageModel,
      options: IMAGE_MODEL_OPTIONS.map((option) => ({
        value: option.value,
        label:
          "descriptorKey" in option && option.descriptorKey
            ? `${option.modelName} · ${t(option.descriptorKey)}`
            : option.modelName,
      })),
      onChange: handleImageModelChange,
      label: t("create.imageModel"),
    }),
    [handleImageModelChange, imageModel, t],
  );
}
