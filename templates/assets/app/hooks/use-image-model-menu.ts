import {
  readClientAppState,
  useT,
  writeClientAppState,
} from "@agent-native/core/client";
import { useCallback, useEffect, useMemo, useState } from "react";

// The composer's model picker shows the chat LLM (Claude/OpenAI/Gemini). The
// Assets app also drives a separate image model, so expose it as a secondary
// menu wherever Assets chat is mounted.
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
] as const;

export function useImageModelMenu() {
  const t = useT();
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL);

  // Hydrate the saved image-model default so the picker reflects the user's
  // last choice across sessions.
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

  const handleImageModelChange = useCallback((value: string) => {
    setImageModel(value);
    void writeClientAppState(IMAGE_MODEL_STATE_KEY, { model: value }).catch(
      () => {},
    );
  }, []);

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
