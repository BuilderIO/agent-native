import { useActionQuery } from "@agent-native/core/client";

export function useDesignSystems() {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: Array<{
      id: string;
      title: string;
      description: string | null;
      data: string;
      isDefault: boolean;
      createdAt: string;
    }>;
  }>("list-design-systems");

  const designSystems = data?.designSystems || [];
  const defaultSystem = designSystems.find((ds) => ds.isDefault);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
