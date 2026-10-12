import { useActionQuery } from "@agent-native/core/client/hooks";
import type { EffectPreviewPolicy } from "@shared/native-effects";

export function useNativeShaderEditorPreferences(): {
  policy: EffectPreviewPolicy | null | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useActionQuery("get-editor-preferences", {});
  return {
    policy:
      query.data === undefined
        ? undefined
        : (query.data.nativeShaderPreview ?? null),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
