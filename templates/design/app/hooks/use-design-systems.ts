import { useActionQuery } from "@agent-native/core/client/hooks";

type DesignSystemSummary = {
  id: string;
  title: string;
  description: string | null;
  data: string;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  createdAt: string;
};

export function useDesignSystems(enabled = true) {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: DesignSystemSummary[];
  }>("list-design-systems", undefined, { enabled });

  const designSystems: DesignSystemSummary[] = data?.designSystems ?? [];
  const defaultSystem = designSystems.find((ds) => ds.isDefault);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
