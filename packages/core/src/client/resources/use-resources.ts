import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Resource {
  id: string;
  path: string;
  owner: string;
  content: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface ResourceMeta {
  id: string;
  path: string;
  owner: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface JobMetadata {
  schedule?: string;
  scheduleDescription?: string;
  enabled?: boolean;
  lastStatus?: "success" | "error" | "running" | "skipped";
  lastRun?: string;
  nextRun?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
  resource?: ResourceMeta;
  /** Parsed metadata for job files (under jobs/) */
  jobMeta?: JobMetadata;
}

export type ResourceScope = "personal" | "shared" | "all";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  return res.json();
}

export function useResources(scope: ResourceScope = "personal") {
  return useQuery<ResourceMeta[]>({
    queryKey: ["resources", "list", scope],
    queryFn: async () => {
      const data = await fetchJson<{ resources: ResourceMeta[] }>(
        `/_agent-native/resources?scope=${scope}`,
      );
      return data.resources;
    },
  });
}

export function useResourceTree(scope: ResourceScope = "personal") {
  return useQuery<TreeNode[]>({
    queryKey: ["resources", "tree", scope],
    queryFn: async () => {
      const data = await fetchJson<{ tree: TreeNode[] }>(
        `/_agent-native/resources/tree?scope=${scope}`,
      );
      return data.tree;
    },
  });
}

export function useResource(id: string | null) {
  return useQuery<Resource>({
    queryKey: ["resource", id],
    queryFn: () => fetchJson(`/_agent-native/resources/${id}`),
    enabled: !!id,
  });
}

export function useCreateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      path: string;
      content?: string;
      mimeType?: string;
      shared?: boolean;
    }) => {
      const res = await fetch("/_agent-native/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.statusText}`);
      return res.json() as Promise<Resource>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

export function useUpdateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      content?: string;
      path?: string;
      mimeType?: string;
    }) => {
      const res = await fetch(`/_agent-native/resources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
      return res.json() as Promise<Resource>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      queryClient.invalidateQueries({ queryKey: ["resource", variables.id] });
    },
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/_agent-native/resources/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

export function useUploadResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/_agent-native/resources/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
      return res.json() as Promise<Resource>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}
