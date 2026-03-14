import { useState, useEffect, useMemo, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBuilderAuth } from "./BuilderAuthContext";
import {
  useBuilderAuthors,
  useBuilderArticles,
  useBuilderDocs,
  useUploadArticle,
} from "@/hooks/use-builder";
import { useGenerateMetaDescription } from "@/hooks/use-generate-meta-description";
import {
  markdownToBuilder,
  titleToHandle,
  estimateReadTime,
  detectTopicAndTags,
  type MarkdownConversionResult,
} from "@/lib/markdown-to-builder";
import { builderToMarkdown } from "@/lib/builder-to-markdown";
import {
  ArticleMetadataForm,
  type ArticleMetadata,
} from "./ArticleMetadataForm";
import { DocsMetadataForm, type DocsMetadata } from "./DocsMetadataForm";
import { ArticlePreviewCard } from "./ArticlePreviewCard";
import {
  Loader2,
  Upload,
  Download,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  X,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  getBuilderMetadata,
  getHeroImage,
  updateBuilderMetadata,
  parseFrontmatter,
  updateFrontmatter,
  updateHeroImage,
} from "@/lib/frontmatter";
import type { BuilderExistingArticle, BuilderBlock } from "@shared/api";

interface BuilderSyncPanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  markdown: string;
  onChange: (newMarkdown: string) => void;
  metadataMarkdown?: string;
  onMetadataMarkdownChange?: (newMarkdown: string) => void;
  projectSlug: string;
  currentHeroImage?: string | null;
  onHeroImageChange?: (url: string | null) => void;
  embedded?: boolean;
  handle: string;
  localUpdatedAt?: string;
  isEditingDraft?: boolean;
}

const EMPTY_ARRAY: any[] = [];

function getFirstAuthorId(
  author: BuilderExistingArticle["data"]["author"],
  authors?: BuilderExistingArticle["data"]["authors"],
) {
  if (author && !Array.isArray(author)) {
    return author.id || "";
  }

  if (Array.isArray(author) && author[0]?.id) {
    return author[0].id;
  }

  if (Array.isArray(authors) && authors[0]?.id) {
    return authors[0].id;
  }

  return "";
}

export function BuilderSyncPanel({
  open = true,
  onOpenChange,
  markdown,
  onChange,
  metadataMarkdown,
  onMetadataMarkdownChange,
  projectSlug,
  currentHeroImage,
  onHeroImageChange,
  embedded = false,
  handle: propHandle,
  localUpdatedAt,
  isEditingDraft = true,
}: BuilderSyncPanelProps) {
  const { auth } = useBuilderAuth();
  const { data: authors = EMPTY_ARRAY } = useBuilderAuthors();
  const { data: articles = EMPTY_ARRAY } = useBuilderArticles();
  const { data: docs = EMPTY_ARRAY } = useBuilderDocs();
  const uploadMutation = useUploadArticle();
  const generateMetaDescription = useGenerateMetaDescription();

  const [conversion, setConversion] = useState<MarkdownConversionResult | null>(
    null,
  );
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionRetryKey, setConversionRetryKey] = useState(0);
  const [metadata, setMetadata] = useState<ArticleMetadata | DocsMetadata>(() =>
    defaultMetadata(),
  );
  const [updateExisting, setUpdateExisting] = useState(true);
  const heroSyncSourceRef = useRef<"builder" | "editor" | null>(null);
  const metadataImageChangedRef = useRef(false);

  // Check frontmatter for existing metadata
  const sourceMarkdown =
    metadataMarkdown !== undefined ? metadataMarkdown : markdown;
  const builderMeta = useMemo(
    () => getBuilderMetadata(sourceMarkdown),
    [sourceMarkdown],
  );
  const existingHero = useMemo(
    () => getHeroImage(sourceMarkdown),
    [sourceMarkdown],
  );

  // Use the appropriate content list based on model type (must be after builderMeta)
  const contentList = builderMeta.model === "docs-content" ? docs : articles;

  const handleMetadataChange = (next: ArticleMetadata | DocsMetadata) => {
    if (next.image !== metadata.image) {
      metadataImageChangedRef.current = true;
    }
    setMetadata(next);

    // Write changes back to metadata markdown immediately when form changes
    const targetMarkdown =
      metadataMarkdown !== undefined ? metadataMarkdown : markdown;
    if (targetMarkdown) {
      // Preserve the model and docsId fields from frontmatter
      const model =
        builderMeta.model ||
        (builderMeta.docsId ? "docs-content" : "blog-article");
      const updates: any = {
        model,
        ...next,
      };

      // Include docsId if present
      if (builderMeta.docsId) {
        updates.docsId = builderMeta.docsId;
      }

      const updatedMarkdown = updateBuilderMetadata(targetMarkdown, updates);
      if (updatedMarkdown !== targetMarkdown) {
        if (onMetadataMarkdownChange) {
          onMetadataMarkdownChange(updatedMarkdown);
        } else {
          onChange(updatedMarkdown);
        }
      }
    }
  };

  // Use last synced tracking for bulletproof sync state, just like Notion sidebar
  const storageKey = `builder-last-synced-${propHandle}`;
  const [lastSyncedMarkdown, setLastSyncedMarkdown] = useState<string | null>(
    () => {
      if (typeof window !== "undefined") {
        return localStorage.getItem(storageKey);
      }
      return null;
    },
  );

  useEffect(() => {
    if (lastSyncedMarkdown && typeof window !== "undefined") {
      localStorage.setItem(storageKey, lastSyncedMarkdown);
    }
  }, [lastSyncedMarkdown, storageKey]);

  // Handle initialization of sync state on mount explicitly against localStorage,
  // bypassing any React state delays
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && markdown === stored) {
        setIsDataSynced(true);
      }
    }
  }, []); // Run once on mount

  // Convert markdown when panel opens
  useEffect(() => {
    if (!open || !markdown) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;

      setConverting(true);
      setConversionError(null);

      // Strip frontmatter before parsing to ensure robust markdown-to-builder extraction
      const contentBody = parseFrontmatter(markdown).content;

      markdownToBuilder(contentBody)
        .then((result) => {
          if (cancelled) return;
          setConversion(result);

          // Auto-detect topic and tags from content
          const detected = detectTopicAndTags(result.title, contentBody);

          // Look up in remote articles to pull down metadata if local YAML is empty/outdated
          const targetHandle =
            builderMeta.handle || propHandle || titleToHandle(result.title);
          const remoteMatch = articles.find(
            (a) => a.data?.handle === targetHandle,
          );
          const remoteData: Partial<BuilderExistingArticle["data"]> =
            remoteMatch?.data || {};

          // Try to extract title from the metadata markdown's H1 if needed
          const metadataContentBody = parseFrontmatter(sourceMarkdown).content;
          const metadataH1Match = metadataContentBody.match(/^#\s+(.+)$/m);
          const metadataTitleFallback = metadataH1Match
            ? metadataH1Match[1]
            : result.title;

          setMetadata((prev) => {
            // Handle docs-content differently from blog-article
            if (builderMeta.model === "docs-content") {
              // Strip /c/docs/ prefix if present in frontmatter
              let localUrl = builderMeta.url || (prev as any).url || "";
              if (localUrl && localUrl.startsWith("/c/docs/")) {
                localUrl = localUrl.substring("/c/docs/".length);
              }

              const next = {
                ...prev,
                url: localUrl,
                pageTitle:
                  builderMeta.pageTitle ||
                  (prev as any).pageTitle ||
                  metadataTitleFallback,
                description:
                  builderMeta.description ||
                  (prev as any).description ||
                  result.firstParagraph,
                hideNav:
                  builderMeta.hideNav !== undefined
                    ? builderMeta.hideNav
                    : (prev as any).hideNav || false,
                shopifyApplicable:
                  builderMeta.shopifyApplicable !== undefined
                    ? builderMeta.shopifyApplicable
                    : (prev as any).shopifyApplicable || false,
                referenceNumber:
                  builderMeta.referenceNumber ||
                  (prev as any).referenceNumber ||
                  "",
                tags:
                  builderMeta.tags && builderMeta.tags.length > 0
                    ? builderMeta.tags
                    : prev.tags && prev.tags.length > 0
                      ? prev.tags
                      : detected.tags,
                redirectToUrl:
                  builderMeta.redirectToUrl ||
                  (prev as any).redirectToUrl ||
                  "",
                redirectToPermanent:
                  builderMeta.redirectToPermanent !== undefined
                    ? builderMeta.redirectToPermanent
                    : (prev as any).redirectToPermanent || false,
                image:
                  builderMeta.image !== undefined
                    ? builderMeta.image
                    : prev.image || existingHero || result.imageUrls[0] || "",
                hideFeedbackColumn:
                  builderMeta.hideFeedbackColumn !== undefined
                    ? builderMeta.hideFeedbackColumn
                    : (prev as any).hideFeedbackColumn || false,
                showToc:
                  builderMeta.showToc !== undefined
                    ? builderMeta.showToc
                    : (prev as any).showToc || false,
                addNoIndex:
                  builderMeta.addNoIndex !== undefined
                    ? builderMeta.addNoIndex
                    : (prev as any).addNoIndex || false,
              };
              const isEqual = Object.keys(next).every(
                (k) => (next as any)[k] === (prev as any)[k],
              );
              return isEqual ? prev : next;
            }

            // Blog article metadata
            const next = {
              ...prev,
              title:
                builderMeta.title ||
                (prev as any).title ||
                remoteData.title ||
                metadataTitleFallback,
              handle:
                builderMeta.handle ||
                (prev as any).handle ||
                remoteData.handle ||
                propHandle ||
                titleToHandle(metadataTitleFallback),
              blurb:
                builderMeta.blurb ||
                (prev as any).blurb ||
                remoteData.blurb ||
                result.firstParagraph,
              metaTitle:
                builderMeta.metaTitle ||
                (prev as any).metaTitle ||
                remoteData.metaTitle ||
                "",
              date:
                (builderMeta.date instanceof Date
                  ? builderMeta.date.toISOString().split("T")[0]
                  : builderMeta.date) ||
                ((prev as any).date && (prev as any).date !== ""
                  ? (prev as any).date
                  : null) ||
                (remoteData.date
                  ? new Date(remoteData.date).toISOString().split("T")[0]
                  : new Date().toISOString().split("T")[0]),
              readTime:
                builderMeta.readTime ||
                ((prev as any).readTime > 0 ? (prev as any).readTime : null) ||
                remoteData.readTime ||
                estimateReadTime(result.wordCount),
              tags:
                builderMeta.tags && builderMeta.tags.length > 0
                  ? builderMeta.tags
                  : prev.tags && prev.tags.length > 0
                    ? prev.tags
                    : remoteData.tags && remoteData.tags.length > 0
                      ? remoteData.tags
                      : detected.tags,
              topic:
                builderMeta.topic ||
                (prev as any).topic ||
                remoteData.topic ||
                detected.topic,
              image:
                builderMeta.image !== undefined
                  ? builderMeta.image
                  : prev.image ||
                    remoteData.image ||
                    existingHero ||
                    result.imageUrls[0] ||
                    "",
              hideImage:
                builderMeta.hideImage !== undefined
                  ? builderMeta.hideImage
                  : (prev as any).hideImage || remoteData.hideImage || false,
              authorId:
                builderMeta.authorId ||
                (prev as any).authorId ||
                getFirstAuthorId(remoteData.author, remoteData.authors),
            };

            const isEqual = Object.keys(next).every(
              (k) => (next as any)[k] === (prev as any)[k],
            );
            return isEqual ? prev : next;
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setConversion(null);
          setConversionError(
            error instanceof Error && error.message
              ? error.message
              : "Failed to convert markdown for Builder.",
          );
        })
        .finally(() => {
          if (cancelled) return;
          setConverting(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, markdown, articles, propHandle, conversionRetryKey]); // purposefully excluding metadataMarkdown and builderMeta to avoid wiping it on secondary render

  // Auto-save metadata to frontmatter (debounced)
  // This effect was causing infinite loops by re-stringifying the markdown on every keystroke
  // It has been replaced by saving directly in handleMetadataChange

  // Check for existing article/doc by handle or docsId
  const matchingArticle = useMemo(() => {
    if (!contentList.length) {
      return null;
    }

    // For docs, match by ID; for articles, match by handle
    if (builderMeta.model === "docs-content") {
      const docsId = builderMeta.docsId;
      if (!docsId) return null;
      return contentList.find((a) => a.id === docsId) || null;
    } else {
      const handle = builderMeta.handle || (metadata as any).handle;
      if (!handle) return null;
      return contentList.find((a) => a.data?.handle === handle) || null;
    }
  }, [
    (metadata as any).handle,
    builderMeta.docsId,
    builderMeta.handle,
    builderMeta.model,
    contentList,
  ]);

  // Keep hero image in sync with editor frontmatter
  useEffect(() => {
    if (!open || !onHeroImageChange || !isEditingDraft) return;
    if (!metadataImageChangedRef.current) return;
    if (heroSyncSourceRef.current === "editor") {
      heroSyncSourceRef.current = null;
      metadataImageChangedRef.current = false;
      return;
    }

    const nextImage = metadata.image?.trim() || null;
    const current = currentHeroImage?.trim() || null;

    // Always trigger change if they differ, so removals work
    if (nextImage !== current) {
      heroSyncSourceRef.current = "builder";
      onHeroImageChange(nextImage);
    }
    metadataImageChangedRef.current = false;
  }, [
    metadata.image,
    open,
    isEditingDraft,
    onHeroImageChange,
    currentHeroImage,
  ]);

  // Pull hero image changes from the editor into metadata
  useEffect(() => {
    if (!open || !isEditingDraft) return;
    if (heroSyncSourceRef.current === "builder") {
      heroSyncSourceRef.current = null;
      return;
    }

    const current = currentHeroImage?.trim() || "";
    // Always trigger if they differ so removals from editor sync back to builder panel
    if (metadata.image !== current) {
      heroSyncSourceRef.current = "editor";
      setMetadata((prev) => ({ ...prev, image: current }));
    }
  }, [currentHeroImage, open, isEditingDraft]);

  const [syncIssues, setSyncIssues] = useState<string[]>([]);

  // Try to initialize to true synchronously if we match localStorage right away,
  // to avoid a split-second flash of the active button before effects run
  const [isDataSynced, setIsDataSynced] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && markdown === stored) {
        return true;
      }
    }
    return false;
  });

  // Parse current markdown state to compare against Builder
  const [remoteBlocks, setRemoteBlocks] = useState<BuilderBlock[] | null>(null);

  // Fetch full article/doc blocks in the background to do accurate sync comparisons
  useEffect(() => {
    const model =
      builderMeta.model ||
      (builderMeta.docsId ? "docs-content" : "blog-article");
    const identifier =
      model === "docs-content"
        ? builderMeta.docsId
        : matchingArticle?.data?.handle;

    if (!identifier || !auth) {
      setRemoteBlocks(null);
      return;
    }

    let cancelled = false;
    const fetchBlocks = async () => {
      try {
        const res = await authFetch("/api/builder/fetch-article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: auth.apiKey,
            handle: identifier,
            model: model,
          }),
        });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRemoteBlocks(data.blocks || []);
      } catch (e) {
        // silently fail background sync check
      }
    };

    fetchBlocks();
    return () => {
      cancelled = true;
    };
  }, [
    matchingArticle?.data?.handle,
    matchingArticle?.lastUpdated,
    builderMeta.docsId,
    builderMeta.model,
    auth,
  ]);

  useEffect(() => {
    if (!matchingArticle || !matchingArticle.data || !markdown) {
      setIsDataSynced(false);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      const contentBody = parseFrontmatter(markdown).content;

      markdownToBuilder(contentBody).then((result) => {
        if (cancelled) return;
        const m = matchingArticle.data;
        const model =
          builderMeta.model ||
          (builderMeta.docsId ? "docs-content" : "blog-article");

        const issues: string[] = [];

        // Check metadata (blog-specific fields)
        if (model === "blog-article") {
          const blogMeta = metadata as ArticleMetadata;
          if (m.title !== blogMeta.title)
            issues.push(`title: '${m.title}' !== '${blogMeta.title}'`);
          if ((m.blurb || "") !== (blogMeta.blurb || "")) issues.push("blurb");
          if ((m.metaTitle || "") !== (blogMeta.metaTitle || ""))
            issues.push("metaTitle");
          if ((m.topic || "") !== (blogMeta.topic || "")) issues.push("topic");
          if ((m.image || "") !== (blogMeta.image || "")) issues.push("image");
          if (!!m.hideImage !== !!blogMeta.hideImage) issues.push("hideImage");

          const remoteDateStr = m.date
            ? new Date(m.date).toISOString().split("T")[0]
            : "";
          const localDateObj =
            typeof blogMeta.date === "string"
              ? new Date(blogMeta.date)
              : blogMeta.date || new Date();
          const localDateStr = blogMeta.date
            ? localDateObj.toISOString().split("T")[0]
            : "";
          if (remoteDateStr !== localDateStr)
            issues.push(`date: '${remoteDateStr}' !== '${localDateStr}'`);

          if ((m.readTime || 1) !== (blogMeta.readTime || 1))
            issues.push(`readTime: ${m.readTime} !== ${blogMeta.readTime}`);

          const remoteAuthorId = getFirstAuthorId(m.author, m.authors);
          if (remoteAuthorId !== (blogMeta.authorId || ""))
            issues.push("authorId");
        } else {
          // Docs-specific metadata checks
          const docsMeta = metadata as DocsMetadata;
          // For docs, url is at root level of matchingArticle, not in data
          const remoteUrl = (matchingArticle as any).url || "";
          // Strip /c/docs/ prefix for comparison with local (which stores without prefix)
          const strippedRemoteUrl = remoteUrl.startsWith("/c/docs/")
            ? remoteUrl.substring("/c/docs/".length)
            : remoteUrl;
          if (strippedRemoteUrl !== (docsMeta.url || "")) issues.push("url");
          if ((m.pageTitle || "") !== (docsMeta.pageTitle || ""))
            issues.push("pageTitle");
          if ((m.description || "") !== (docsMeta.description || ""))
            issues.push("description");
          if (!!m.hideNav !== !!docsMeta.hideNav) issues.push("hideNav");
          if (!!m.shopifyApplicable !== !!docsMeta.shopifyApplicable)
            issues.push("shopifyApplicable");
          if ((m.referenceNumber || "") !== (docsMeta.referenceNumber || ""))
            issues.push("referenceNumber");
          if ((m.redirectToUrl || "") !== (docsMeta.redirectToUrl || ""))
            issues.push("redirectToUrl");
          if (!!m.redirectToPermanent !== !!docsMeta.redirectToPermanent)
            issues.push("redirectToPermanent");
          if ((m.image || "") !== (docsMeta.image || "")) issues.push("image");
          if (!!m.hideFeedbackColumn !== !!docsMeta.hideFeedbackColumn)
            issues.push("hideFeedbackColumn");
          if (!!m.showToc !== !!docsMeta.showToc) issues.push("showToc");
          if (!!m.addNoIndex !== !!docsMeta.addNoIndex)
            issues.push("addNoIndex");
        }

        const localTags = [...(metadata.tags || [])].sort();
        const remoteTags = [...(m.tags || [])].sort();
        if (localTags.join(",") !== remoteTags.join(",")) issues.push("tags");

        // Check content blocks
        const blocksToCheck = remoteBlocks || m.blocks;
        if (issues.length === 0 && blocksToCheck) {
          try {
            const remoteBlocksArr = blocksToCheck as BuilderBlock[];
            const remoteMarkdown = builderToMarkdown(remoteBlocksArr);
            const localMarkdown = builderToMarkdown(result.blocks);

            if (remoteMarkdown.trim() !== localMarkdown.trim()) {
              issues.push("markdown body mismatch");
              // Store a tiny bit of the mismatch to debug
              const rmFull = remoteMarkdown.trim();
              const lmFull = localMarkdown.trim();
              let firstDiff = -1;
              for (let i = 0; i < Math.max(rmFull.length, lmFull.length); i++) {
                if (rmFull[i] !== lmFull[i]) {
                  firstDiff = i;
                  break;
                }
              }
              if (firstDiff !== -1) {
                issues.push(`diff at ${firstDiff}`);
                issues.push(
                  `r: ${JSON.stringify(rmFull.substring(firstDiff - 10, firstDiff + 10))}`,
                );
                issues.push(
                  `l: ${JSON.stringify(lmFull.substring(firstDiff - 10, firstDiff + 10))}`,
                );
              }
            }
          } catch (e) {
            issues.push("parse error blocks");
          }
        } else if (issues.length === 0 && result.blocks.length > 0) {
          // Only report remote has no blocks if we successfully fetched remoteBlocks
          // and it was empty. If remoteBlocks is null, we are still fetching, so
          // don't report a mismatch yet to avoid flashing warning.
          if (remoteBlocks && remoteBlocks.length === 0) {
            issues.push("remote has no blocks");
          }
        }

        setSyncIssues(issues);

        // Check both state and localStorage directly to avoid state race conditions on mount
        let currentlySynced = lastSyncedMarkdown;
        if (currentlySynced === null && typeof window !== "undefined") {
          currentlySynced = localStorage.getItem(storageKey);
        }

        // If we match our last synced markdown perfectly, force synced state to true
        // This prevents the sync indicator from thrashing when the API returns slightly different normalized markdown
        // Also account for the fact that during active pulling/pushing, React state is still settling
        if (currentlySynced !== null && markdown === currentlySynced) {
          setIsDataSynced(true);
        } else {
          setIsDataSynced(issues.length === 0);
        }
      });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    matchingArticle,
    metadata,
    markdown,
    remoteBlocks,
    lastSyncedMarkdown,
    storageKey,
  ]);

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => a.data?.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [articles]);

  const existingTopics = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => {
      if (a.data?.topic) set.add(a.data.topic);
    });
    return Array.from(set).sort();
  }, [articles]);

  const handleGenerateMetaDescription = async () => {
    const articleContent = parseFrontmatter(markdown).content.trim();

    if (!articleContent) {
      toast.error(
        "Add some article content before generating a meta description",
      );
      return;
    }

    try {
      const result = await generateMetaDescription.mutateAsync({
        articleContent,
        projectSlug,
        title: (metadata as ArticleMetadata).title,
      });

      handleMetadataChange({
        ...(metadata as ArticleMetadata),
        blurb: result.description,
      });
      toast.success("Meta description generated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate meta description");
    }
  };

  const selectedAuthor =
    builderMeta.model !== "docs-content"
      ? authors.find((a) => a.id === (metadata as ArticleMetadata).authorId)
      : undefined;
  const authorName =
    selectedAuthor?.data?.fullName || selectedAuthor?.name || "";

  const isLocalAhead = useMemo(() => {
    if (!matchingArticle || !matchingArticle.lastUpdated || !localUpdatedAt)
      return true;
    return new Date(localUpdatedAt).getTime() > matchingArticle.lastUpdated;
  }, [matchingArticle, localUpdatedAt]);

  const [fetching, setFetching] = useState(false);
  const [fetchedData, setFetchedData] = useState<{
    content: string;
    title: string;
    metadata: ArticleMetadata | DocsMetadata;
    metadataDiff: Record<string, { old: any; new: any }>;
    contentChanged: boolean;
  } | null>(null);
  const [fetchError, setFetchError] = useState("");

  const handleFetch = async () => {
    // Determine the identifier and model to use
    const model =
      builderMeta.model ||
      (builderMeta.docsId ? "docs-content" : "blog-article");
    const identifier =
      builderMeta.docsId ||
      builderMeta.handle ||
      (metadata as any).handle ||
      (metadata as any).url;

    if (!auth || !identifier) return;

    setFetching(true);
    setFetchError("");
    setFetchedData(null);

    try {
      const res = await authFetch("/api/builder/fetch-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: auth.apiKey,
          handle: identifier,
          model: model,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch article from Builder");
      }

      const data = await res.json();
      const blocks = data.blocks as BuilderBlock[];
      const fullData = data.fullData || {};

      if (!blocks || blocks.length === 0) {
        throw new Error("No content blocks found in this article");
      }

      const newMarkdown = builderToMarkdown(blocks);

      const currentContentBody = parseFrontmatter(markdown).content.trim();
      const newContentBody = newMarkdown.trim();
      const contentChanged = currentContentBody !== newContentBody;

      // Use the model already declared at the start of handleFetch
      let newMetadata: ArticleMetadata | DocsMetadata;
      let keysToCheck: string[];

      if (model === "docs-content") {
        // Get url from root level of response (data.url), not fullData
        let fetchedUrl =
          data.url || fullData.url || (metadata as any).url || "";

        // Strip /c/docs/ prefix for local storage
        if (fetchedUrl && fetchedUrl.startsWith("/c/docs/")) {
          fetchedUrl = fetchedUrl.substring("/c/docs/".length);
        }

        newMetadata = {
          ...metadata,
          url: fetchedUrl,
          pageTitle:
            fullData.pageTitle ??
            data.title ??
            (metadata as any).pageTitle ??
            "",
          description:
            fullData.description ?? (metadata as any).description ?? "",
          hideNav:
            fullData.hideNav !== undefined
              ? fullData.hideNav
              : ((metadata as any).hideNav ?? false),
          shopifyApplicable:
            fullData.shopifyApplicable !== undefined
              ? fullData.shopifyApplicable
              : ((metadata as any).shopifyApplicable ?? false),
          referenceNumber:
            fullData.referenceNumber ?? (metadata as any).referenceNumber ?? "",
          tags: fullData.tags ?? [],
          redirectToUrl:
            fullData.redirectToUrl ?? (metadata as any).redirectToUrl ?? "",
          redirectToPermanent:
            fullData.redirectToPermanent !== undefined
              ? fullData.redirectToPermanent
              : ((metadata as any).redirectToPermanent ?? false),
          image: fullData.image ?? "",
          hideFeedbackColumn:
            fullData.hideFeedbackColumn !== undefined
              ? fullData.hideFeedbackColumn
              : ((metadata as any).hideFeedbackColumn ?? false),
          showToc:
            fullData.showToc !== undefined
              ? fullData.showToc
              : ((metadata as any).showToc ?? false),
          addNoIndex:
            fullData.addNoIndex !== undefined
              ? fullData.addNoIndex
              : ((metadata as any).addNoIndex ?? false),
        } as DocsMetadata;
        keysToCheck = [
          "url",
          "pageTitle",
          "description",
          "hideNav",
          "shopifyApplicable",
          "referenceNumber",
          "redirectToUrl",
          "redirectToPermanent",
          "image",
          "hideFeedbackColumn",
          "showToc",
          "addNoIndex",
        ];
      } else {
        newMetadata = {
          ...metadata,
          title: data.title ?? fullData.title ?? (metadata as any).title,
          blurb: fullData.blurb ?? "",
          metaTitle: fullData.metaTitle ?? "",
          date: fullData.date
            ? new Date(fullData.date).toISOString().split("T")[0]
            : (metadata as any).date || new Date().toISOString().split("T")[0],
          readTime:
            fullData.readTime ||
            ((metadata as any).readTime > 0 ? (metadata as any).readTime : 1),
          tags: fullData.tags ?? [],
          topic: fullData.topic ?? "",
          image: fullData.image ?? "",
          hideImage: !!fullData.hideImage,
          authorId: getFirstAuthorId(fullData.author, fullData.authors),
        } as ArticleMetadata;
        keysToCheck = [
          "title",
          "blurb",
          "metaTitle",
          "date",
          "readTime",
          "topic",
          "image",
          "hideImage",
          "authorId",
        ];
      }

      const metadataDiff: Record<string, { old: any; new: any }> = {};
      for (const key of keysToCheck) {
        if ((metadata as any)[key] !== (newMetadata as any)[key]) {
          metadataDiff[key] = {
            old: (metadata as any)[key],
            new: (newMetadata as any)[key],
          };
        }
      }

      const localTags = [...(metadata.tags || [])].sort();
      const remoteTags = [...(newMetadata.tags || [])].sort();
      if (localTags.join(",") !== remoteTags.join(",")) {
        metadataDiff.tags = { old: metadata.tags, new: newMetadata.tags };
      }

      const displayTitle =
        model === "docs-content"
          ? data.title ||
            (metadata as DocsMetadata).pageTitle ||
            (metadata as DocsMetadata).url
          : data.title || (metadata as ArticleMetadata).handle;

      setFetchedData({
        content: newMarkdown,
        title: displayTitle,
        metadata: newMetadata,
        metadataDiff,
        contentChanged,
      });
    } catch (err: any) {
      setFetchError(err.message);
    } finally {
      setFetching(false);
    }
  };

  const handleApplyPull = () => {
    if (fetchedData) {
      const parsed = parseFrontmatter(markdown);

      // Construct markdown with existing frontmatter and new body content
      let markdownToUpdate = "";
      const hasFrontmatter = markdown.match(
        /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/,
      );

      if (hasFrontmatter) {
        markdownToUpdate = `${hasFrontmatter[0]}\n${fetchedData.content}`;
      } else {
        markdownToUpdate = `---\n\n---\n${fetchedData.content}`;
      }

      const metaToApply = fetchedData.metadata;
      const model =
        builderMeta.model ||
        (builderMeta.docsId ? "docs-content" : "blog-article");

      // Because handleApplyPull branches a lot, track the final generated string here
      let resultingMarkdown = "";
      if (isEditingDraft) {
        // The editor is open to draft.md, so metadata and body are in the same file.
        // We apply metadata to the newly constructed markdownToUpdate.
        let finalMarkdown = updateBuilderMetadata(
          markdownToUpdate,
          metaToApply as any,
        );
        finalMarkdown = updateHeroImage(
          finalMarkdown,
          metaToApply.image || null,
        );
        resultingMarkdown = finalMarkdown;
        onChange(finalMarkdown);
      } else if (onMetadataMarkdownChange) {
        // Separate files. Apply metadata to the draft.md (metadataMarkdown) and body to current file
        const targetMarkdown =
          metadataMarkdown !== undefined ? metadataMarkdown : markdown;

        let updatedMetadataMarkdown = updateBuilderMetadata(
          targetMarkdown,
          metaToApply as any,
        );

        // Also update the hero_image field to ensure both fields are in sync
        updatedMetadataMarkdown = updateHeroImage(
          updatedMetadataMarkdown,
          metaToApply.image || null,
        );
        resultingMarkdown = markdownToUpdate; // body only

        onMetadataMarkdownChange(updatedMetadataMarkdown);
        // We also need to update the markdown body without modifying its metadata
        onChange(markdownToUpdate);
      } else {
        // Fallback for embedded usage without separate metadata markdown
        let updatedMetadataMarkdown = updateBuilderMetadata(
          markdownToUpdate,
          metaToApply as any,
        );
        updatedMetadataMarkdown = updateHeroImage(
          updatedMetadataMarkdown,
          metaToApply.image || null,
        );
        resultingMarkdown = updatedMetadataMarkdown;
        onChange(updatedMetadataMarkdown);
      }

      setMetadata(metaToApply);

      setFetchedData(null);
      setLastSyncedMarkdown(resultingMarkdown);
      setIsDataSynced(true);
      toast.success("Content pulled from Builder.io");
    }
  };

  const handleUpload = async () => {
    if (!auth || !conversion) return;

    // Determine the model to use
    const model =
      builderMeta.model ||
      (builderMeta.docsId ? "docs-content" : "blog-article");
    const identifier =
      builderMeta.docsId ||
      builderMeta.handle ||
      (metadata as any).handle ||
      (metadata as any).url;

    let contentData: Record<string, unknown>;
    let contentName: string;
    let transformedUrl: string | undefined;

    if (model === "docs-content") {
      const docsMetadata = metadata as DocsMetadata;

      // Transform URL: add /c/docs/ prefix if not already present
      transformedUrl = docsMetadata.url;
      if (transformedUrl && !transformedUrl.startsWith("/c/docs/")) {
        // Remove leading slash if present, then add prefix
        transformedUrl = transformedUrl.startsWith("/")
          ? `/c/docs${transformedUrl}`
          : `/c/docs/${transformedUrl}`;
      }

      // For docs-content, url is at root level, not in data
      contentData = {
        pageTitle: docsMetadata.pageTitle,
        description: docsMetadata.description,
        hideNav: docsMetadata.hideNav,
        shopifyApplicable: docsMetadata.shopifyApplicable,
        referenceNumber: docsMetadata.referenceNumber,
        tags: docsMetadata.tags,
        redirectToUrl: docsMetadata.redirectToUrl,
        redirectToPermanent: docsMetadata.redirectToPermanent,
        image: docsMetadata.image
          ? docsMetadata.image.replace(/%2F/g, "/")
          : docsMetadata.image,
        hideFeedbackColumn: docsMetadata.hideFeedbackColumn,
        showToc: docsMetadata.showToc,
        addNoIndex: docsMetadata.addNoIndex,
        blocks: conversion.blocks,
      };
      contentName = docsMetadata.pageTitle || docsMetadata.url;
    } else {
      const articleMetadata = metadata as ArticleMetadata;
      const calculatedReadTime = Math.max(
        1,
        Math.ceil(conversion.wordCount / 225),
      );
      contentData = {
        title: articleMetadata.title,
        handle: identifier,
        blurb: articleMetadata.blurb,
        date:
          (articleMetadata.date as any) instanceof Date
            ? (articleMetadata.date as any).getTime()
            : new Date(articleMetadata.date).getTime(),
        readTime: calculatedReadTime,
        tags: articleMetadata.tags,
        topic: articleMetadata.topic,
        image: articleMetadata.image
          ? articleMetadata.image.replace(/%2F/g, "/")
          : articleMetadata.image,
        hideImage: articleMetadata.hideImage,
        blocks: conversion.blocks,
      };

      if (articleMetadata.metaTitle) {
        contentData.metaTitle = articleMetadata.metaTitle;
      }

      if (articleMetadata.authorId) {
        contentData.author = {
          "@type": "@builder.io/core:Reference",
          id: articleMetadata.authorId,
          model: "blog-author",
        };
      }

      contentName = articleMetadata.title;
    }

    const isUpdate = Boolean(updateExisting && matchingArticle);

    // For docs-content, url goes at root level; for blog-article, everything is in data
    const payload = {
      apiKey: auth.apiKey,
      privateKey: auth.privateKey,
      article: {
        name: contentName,
        ...(isUpdate ? {} : { published: "draft" as const }),
        ...(model === "docs-content" && transformedUrl
          ? { url: transformedUrl }
          : {}),
        data: contentData,
      },
      model,
      existingId: isUpdate && matchingArticle ? matchingArticle.id : undefined,
    };

    // Track the markdown we are pushing so we don't immediately report out of sync
    setLastSyncedMarkdown(markdown);
    // Explicitly set true right away
    setIsDataSynced(true);

    uploadMutation.mutate(payload as any);
  };

  const isReady =
    !converting &&
    conversion &&
    (builderMeta.model === "docs-content"
      ? (metadata as DocsMetadata).pageTitle &&
        (metadata as DocsMetadata).url &&
        (metadata as DocsMetadata).description.length >= 110 &&
        (metadata as DocsMetadata).description.length <= 163
      : (metadata as ArticleMetadata).title &&
        (metadata as ArticleMetadata).handle);

  return (
    <div
      className={cn(
        "h-full bg-background flex flex-col shrink-0 transition-all duration-200 overflow-hidden",
        !embedded && "border-l border-border",
        open || embedded
          ? embedded
            ? "w-full"
            : "w-[340px]"
          : "w-0 border-l-0",
      )}
    >
      {(open || embedded) && (
        <>
          {/* Header */}
          {!embedded && (
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground">
                Upload to Builder
              </h3>
              <button
                onClick={() => onOpenChange(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {converting ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">
                Converting...
              </span>
            </div>
          ) : conversionError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Builder conversion failed
                </p>
                <p className="text-sm text-muted-foreground">
                  {conversionError}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConversionRetryKey((current) => current + 1)}
              >
                <RefreshCw className="h-4 w-4" />
                Retry conversion
              </Button>
            </div>
          ) : !conversion ? (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <span className="text-sm text-muted-foreground">
                Add content to start Builder conversion.
              </span>
            </div>
          ) : uploadMutation.isSuccess ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium text-foreground text-center">
                Article {matchingArticle ? "updated" : "uploaded"} as draft!
              </p>
              {uploadMutation.data?.id && (
                <a
                  href={`https://builder.io/content/${uploadMutation.data.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <ExternalLink size={12} />
                  Open in Builder.io
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  uploadMutation.reset();
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4 space-y-4">
                  {fetching || fetchedData ? (
                    <>
                      {/* Fetch flow UI */}
                      {fetching && (
                        <div className="flex flex-col items-center justify-center py-8 gap-3 border rounded-md border-dashed">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            Fetching from Builder...
                          </p>
                        </div>
                      )}

                      {fetchedData && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                          {fetchedData.contentChanged ||
                          Object.keys(fetchedData.metadataDiff).length > 0 ? (
                            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-600 dark:text-amber-400">
                                  <p className="font-medium mb-1">
                                    Apply Changes
                                  </p>
                                  Applying will overwrite your local editor
                                  content with the latest from Builder.io.
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                              <div className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                                <div className="text-xs text-green-600 dark:text-green-400">
                                  <p className="font-medium mb-1">Up to date</p>
                                  No changes found. Your local editor is already
                                  in sync with Builder.io.
                                </div>
                              </div>
                            </div>
                          )}

                          {Object.keys(fetchedData.metadataDiff).length > 0 && (
                            <div className="text-xs space-y-2 border border-border rounded-md overflow-hidden">
                              <div className="bg-muted px-3 py-2 font-medium border-b border-border">
                                <span>Metadata Changes</span>
                              </div>
                              <div className="p-3 max-h-[200px] overflow-auto bg-background">
                                <ul className="space-y-3">
                                  {Object.entries(fetchedData.metadataDiff).map(
                                    ([key, diff]) => (
                                      <li
                                        key={key}
                                        className="grid grid-cols-[80px_1fr] gap-3 items-start border-b border-border/50 pb-2 last:border-0 last:pb-0"
                                      >
                                        <span className="font-semibold text-muted-foreground capitalize mt-1">
                                          {key}:
                                        </span>
                                        <div className="flex flex-col gap-1.5">
                                          <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                              Current
                                            </span>
                                            <span className="text-red-500/80 line-through break-all">
                                              {JSON.stringify(diff.old) ||
                                                "empty"}
                                            </span>
                                          </div>
                                          <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                              New
                                            </span>
                                            <span className="text-green-500 break-all">
                                              {JSON.stringify(diff.new) ||
                                                "empty"}
                                            </span>
                                          </div>
                                        </div>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            </div>
                          )}

                          {fetchedData.contentChanged && (
                            <div className="text-xs space-y-2 border border-border rounded-md overflow-hidden">
                              <div className="bg-muted px-3 py-2 font-medium border-b border-border flex justify-between">
                                <span>Article Body Changes</span>
                                <span className="text-muted-foreground">
                                  {fetchedData.content.length} chars
                                </span>
                              </div>
                              <div className="p-3 max-h-[250px] overflow-auto text-[11px] whitespace-pre-wrap font-mono text-muted-foreground">
                                {fetchedData.content.length > 500
                                  ? fetchedData.content.substring(0, 500) +
                                    "..."
                                  : fetchedData.content}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {fetchError && (
                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex justify-between items-center">
                          <span>{fetchError}</span>
                          <button
                            onClick={() => setFetchError("")}
                            className="text-destructive/80 hover:text-destructive"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      {matchingArticle && matchingArticle.id && (
                        <div className="flex justify-end -mb-2">
                          <a
                            href={`https://builder.io/content/${matchingArticle.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 font-medium"
                          >
                            Open in Builder <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}

                      {/* Metadata form */}
                      {builderMeta.model === "docs-content" ? (
                        <DocsMetadataForm
                          metadata={metadata as DocsMetadata}
                          onChange={handleMetadataChange}
                          existingTags={existingTags}
                        />
                      ) : (
                        <ArticleMetadataForm
                          metadata={metadata as ArticleMetadata}
                          onChange={handleMetadataChange}
                          authors={authors}
                          existingTopics={existingTopics}
                          existingTags={existingTags}
                          imageOptions={conversion?.imageUrls || []}
                          projectSlug={projectSlug}
                          onGenerateMetaDescription={
                            handleGenerateMetaDescription
                          }
                          isGeneratingMetaDescription={
                            generateMetaDescription.isPending
                          }
                        />
                      )}

                      {conversion && (
                        <p className="text-[11px] text-muted-foreground">
                          {conversion.blocks.length} blocks ·{" "}
                          {conversion.wordCount} words ·{" "}
                          {conversion.imageUrls.length} images
                          {conversion.videoUrls.length > 0 &&
                            ` · ${conversion.videoUrls.length} videos`}
                        </p>
                      )}

                      {/* Preview card - only for blog articles */}
                      {builderMeta.model !== "docs-content" && (
                        <ArticlePreviewCard
                          title={(metadata as ArticleMetadata).title}
                          blurb={(metadata as ArticleMetadata).blurb}
                          image={metadata.image}
                          tags={metadata.tags}
                          authorName={authorName}
                          readTime={(metadata as ArticleMetadata).readTime}
                        />
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>

              {/* Footer Actions */}
              <div className="px-4 py-3 border-t border-border shrink-0 bg-background">
                {fetchedData ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleApplyPull}
                      className="w-full"
                      variant="default"
                      disabled={
                        !fetchedData.contentChanged &&
                        Object.keys(fetchedData.metadataDiff).length === 0
                      }
                    >
                      <ArrowRight className="w-4 h-4 mr-2" />
                      Apply Changes to Editor
                    </Button>
                    <Button
                      onClick={() => setFetchedData(null)}
                      className="w-full"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {uploadMutation.isError && (
                      <p className="text-xs text-destructive">
                        {(uploadMutation.error as Error)?.message ||
                          "Upload failed"}
                      </p>
                    )}

                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={handleFetch}
                        disabled={
                          !(
                            builderMeta.docsId ||
                            builderMeta.handle ||
                            (metadata as any).handle ||
                            (metadata as any).url
                          ) ||
                          !auth ||
                          fetching ||
                          isDataSynced
                        }
                        className="w-full relative disabled:opacity-50"
                        variant={
                          !isDataSynced && !isLocalAhead && matchingArticle
                            ? "default"
                            : "outline"
                        }
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {!isDataSynced && !isLocalAhead && matchingArticle
                          ? "Pull updates from Builder"
                          : "Pull from Builder"}
                        {!isDataSynced && !isLocalAhead && matchingArticle && (
                          <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-blue-500"></span>
                        )}
                      </Button>

                      <Button
                        className="w-full relative disabled:opacity-50"
                        onClick={handleUpload}
                        variant={
                          (!isDataSynced && isLocalAhead) || !matchingArticle
                            ? "default"
                            : "outline"
                        }
                        disabled={
                          !isReady ||
                          uploadMutation.isPending ||
                          fetching ||
                          (isDataSynced && !!matchingArticle)
                        }
                      >
                        {uploadMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Pushing...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            {!isDataSynced && matchingArticle
                              ? "Push updates to Builder"
                              : "Push to Builder"}
                            {((!isDataSynced && isLocalAhead) ||
                              !matchingArticle) && (
                              <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-blue-500"></span>
                            )}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function defaultMetadata(model?: string): ArticleMetadata | DocsMetadata {
  if (model === "docs-content") {
    return {
      url: "",
      pageTitle: "",
      description: "",
      hideNav: false,
      shopifyApplicable: false,
      referenceNumber: "",
      tags: [],
      redirectToUrl: "",
      redirectToPermanent: false,
      image: "",
      hideFeedbackColumn: false,
      showToc: false,
      addNoIndex: false,
    } as DocsMetadata;
  }

  return {
    title: "",
    handle: "",
    blurb: "",
    metaTitle: "",
    date: "",
    readTime: 0,
    tags: [],
    topic: "",
    image: "",
    hideImage: false,
    published: false,
    authorId: "",
  } as ArticleMetadata;
}
