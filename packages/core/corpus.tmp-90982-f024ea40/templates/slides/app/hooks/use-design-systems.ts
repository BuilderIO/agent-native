import { useActionQuery } from "@agent-native/core/client";

type DesignSystemSummary = {
  id: string;
  title: string;
  description: string | null;
  data: string;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  createdAt: string;
};

export function useDesignSystems() {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: DesignSystemSummary[];
  }>("list-design-systems");

  const designSystems: DesignSystemSummary[] = data?.designSystems ?? [];
  const defaultSystem =
    designSystems.find((ds) => ds.isDefault) ?? designSystems[0];

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
