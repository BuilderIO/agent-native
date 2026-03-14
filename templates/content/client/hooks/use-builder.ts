import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import { useBuilderAuth } from "@/components/builder/BuilderAuthContext";
import { useCreateProject } from "@/hooks/use-projects";
import { builderToMarkdown } from "@/lib/builder-to-markdown";
import type {
  BuilderAuthor,
  BuilderBlogIndexItem,
  BuilderDocsIndexItem,
  BuilderExistingArticle,
  BuilderExistingDoc,
  BuilderUploadRequest,
  BuilderUploadResponse,
  ProjectCreateResponse,
} from "@shared/api";

export function useBuilderAuthors() {
  const { auth } = useBuilderAuth();
  return useQuery({
    queryKey: ["builder-authors", auth?.apiKey],
    queryFn: async (): Promise<BuilderAuthor[]> => {
      if (!auth) return [];
      const res = await authFetch("/api/builder/authors", {
        headers: { "x-builder-api-key": auth.apiKey },
      });
      if (!res.ok) throw new Error("Failed to fetch authors");
      const data = await res.json();
      return data.authors;
    },
    enabled: !!auth,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBuilderArticles() {
  const { auth } = useBuilderAuth();
  return useQuery({
    queryKey: ["builder-articles", auth?.apiKey],
    queryFn: async (): Promise<BuilderExistingArticle[]> => {
      if (!auth) return [];
      const res = await authFetch("/api/builder/articles", {
        headers: { "x-builder-api-key": auth.apiKey },
      });
      if (!res.ok) throw new Error("Failed to fetch articles");
      const data = await res.json();
      return data.articles;
    },
    enabled: !!auth,
    staleTime: 2 * 60 * 1000,
  });
}

export function useBuilderDocs() {
  const { auth } = useBuilderAuth();
  return useQuery({
    queryKey: ["builder-docs", auth?.apiKey],
    queryFn: async (): Promise<BuilderExistingDoc[]> => {
      if (!auth) return [];
      const res = await authFetch("/api/builder/docs", {
        headers: { "x-builder-api-key": auth.apiKey },
      });
      if (!res.ok) throw new Error("Failed to fetch docs");
      const data = await res.json();
      return data.docs;
    },
    enabled: !!auth,
    staleTime: 2 * 60 * 1000,
  });
}

export function useBuilderBlogIndex(enabled: boolean = true) {
  const { auth } = useBuilderAuth();
  return useQuery({
    queryKey: ["builder-blog-index", auth?.apiKey],
    queryFn: async (): Promise<BuilderBlogIndexItem[]> => {
      if (!auth) return [];
      const res = await authFetch("/api/builder/blog-index", {
        headers: { "x-builder-api-key": auth.apiKey },
      });
      if (!res.ok) throw new Error("Failed to fetch Builder blog index");
      const data = await res.json();
      return data.articles;
    },
    enabled: enabled && !!auth,
    staleTime: 2 * 60 * 1000,
  });
}

export function useBuilderDocsIndex(enabled: boolean = true) {
  const { auth } = useBuilderAuth();
  return useQuery({
    queryKey: ["builder-docs-index", auth?.apiKey],
    queryFn: async (): Promise<BuilderDocsIndexItem[]> => {
      if (!auth) return [];
      const res = await authFetch("/api/builder/docs-index", {
        headers: { "x-builder-api-key": auth.apiKey },
      });
      if (!res.ok) throw new Error("Failed to fetch Builder docs index");
      const data = await res.json();
      return data.docs;
    },
    enabled: enabled && !!auth,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateProjectFromBuilder() {
  const { auth } = useBuilderAuth();
  const queryClient = useQueryClient();
  const createProject = useCreateProject();

  return useMutation({
    mutationFn: async ({
      handle,
      name,
      group,
    }: {
      handle: string;
      name: string;
      group?: string;
    }): Promise<ProjectCreateResponse> => {
      if (!auth) throw new Error("Not connected to Builder");

      const res = await authFetch("/api/builder/fetch-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: auth.apiKey, handle }),
      });

      if (!res.ok) throw new Error("Failed to fetch article from Builder");

      const articleData = await res.json();
      const fullData = articleData.fullData;
      const blocks = Array.isArray(articleData.blocks)
        ? articleData.blocks
        : Array.isArray(fullData?.blocks)
          ? fullData.blocks
          : [];
      const blocksString = blocks.length > 0 ? builderToMarkdown(blocks) : undefined;

      return createProject.mutateAsync({
        name,
        group,
        builderHandle: handle,
        fullData,
        blocksString,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["builder-blog-index"] });
    },
  });
}

export function useCreateProjectFromDocs() {
  const queryClient = useQueryClient();
  const createProject = useCreateProject();

  return useMutation({
    mutationFn: async ({
      docsId,
      name,
      group,
    }: {
      docsId: string;
      name: string;
      group?: string;
    }): Promise<ProjectCreateResponse> => {
      return createProject.mutateAsync({
        name,
        group,
        builderDocsId: docsId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["builder-docs-index"] });
    },
  });
}

export function useUploadImage() {
  const { auth } = useBuilderAuth();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!auth) throw new Error("Not connected to Builder");

      const formData = new FormData();
      formData.append("file", file);

      const res = await authFetch("/api/builder/image", {
        method: "POST",
        headers: {
          "x-builder-api-key": auth.apiKey,
          "x-builder-private-key": auth.privateKey,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Image upload failed");
      }
      return data.url;
    },
  });
}

export function useUploadArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: BuilderUploadRequest & { existingId?: string }
    ): Promise<BuilderUploadResponse> => {
      const url = payload.existingId
        ? `/api/builder/upload/${payload.existingId}`
        : "/api/builder/upload";
      const method = payload.existingId ? "PUT" : "POST";

      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: payload.apiKey,
          privateKey: payload.privateKey,
          article: payload.article,
          model: payload.model,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Upload failed");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["builder-articles"] });
    },
  });
}
