import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { getNotionMetadata, updateNotionMetadata, parseFrontmatter, getBuilderMetadata, updateHeroImage } from "@/lib/frontmatter";
import { markdownToNotionBlocks } from "@/lib/markdown-to-notion";
import { notionBlocksToMarkdown } from "@/lib/notion-to-markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ExternalLink, Download, Upload, CheckCircle2, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUploadImage } from "@/hooks/use-builder";
import { useBuilderAuth } from "@/components/builder/BuilderAuthContext";

import { useQuery, useQueryClient } from "@tanstack/react-query";

interface NotionSyncPanelProps {
  markdown: string;
  onChange: (markdown: string) => void;
  projectSlug: string;
  onSyncStatusChange?: (status: 'idle' | 'syncing' | 'synced') => void;
  autoSyncOnly?: boolean;
}

export function NotionSyncPanel({ markdown, onChange, projectSlug, onSyncStatusChange, autoSyncOnly }: NotionSyncPanelProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPageSelector, setShowPageSelector] = useState(false);
  const hasAutoPulledRef = useRef(false);
  const lastPullMarkdownRef = useRef<string | null>(null);
  const builderMeta = getBuilderMetadata(markdown);
  const handle = builderMeta.handle || projectSlug;
  const notionMeta = getNotionMetadata(markdown);

  // Auto-show selector when no page is linked
  useEffect(() => {
    if (!notionMeta.page_id) {
      setShowPageSelector(true);
    }
  }, [notionMeta.page_id]);
  const { data: frontmatterData } = parseFrontmatter(markdown);
  const title = frontmatterData.title || "";
  const { isConnected } = useBuilderAuth();
  const uploadImageMutation = useUploadImage();
  const queryClient = useQueryClient();

  const storageKey = `notion-last-synced-${handle}`;
  const lastEditedStorageKey = `notion-last-edited-${handle}`;

  // Initialize from localStorage if available
  const [lastSyncedMarkdown, setLastSyncedMarkdown] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(storageKey);
    }
    return null;
  });

  // Try to initialize to true synchronously if we match localStorage right away,
  // to avoid a split-second flash of the active button before effects run
  const [isDataSynced, setIsDataSynced] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && markdown === stored) {
        return true;
      }
    }
    return false;
  });
  const { data: schemaRes, isLoading: isSchemaLoading } = useQuery({
    queryKey: ['notion-schema'],
    queryFn: () => authFetch("/api/notion/schema").then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: pagesRes, isLoading: isPagesLoading } = useQuery({
    queryKey: ['notion-pages'],
    queryFn: () => authFetch("/api/notion/pages").then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: pageMeta } = useQuery({
    queryKey: ['notion-page-meta', notionMeta.page_id],
    queryFn: async () => {
      if (!notionMeta.page_id) return null;
      const res = await authFetch(`/api/notion/page-meta?pageId=${notionMeta.page_id}`);
      return res.json();
    },
    enabled: !!notionMeta.page_id,
  });

  // Deep verification of external edits
  useEffect(() => {
    if (!pageMeta?.page?.last_edited_time || !notionMeta.page_id) return;

    const localLastEdited = localStorage.getItem(lastEditedStorageKey);
    const remoteLastEdited = pageMeta.page.last_edited_time;

    if (localLastEdited && remoteLastEdited !== localLastEdited) {
      const verifyChange = async () => {
        try {
          const res = await authFetch("/api/notion/fetch-page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageId: notionMeta.page_id }),
          });
          const data = await res.json();
          if (data.error) return;

          let blocksToConvert = data.blocks;
          let pulledHeroImage: string | null = null;
          if (blocksToConvert && blocksToConvert.length > 0 && blocksToConvert[0].type === "image") {
            const imageBlock = blocksToConvert[0].image;
            if (imageBlock.type === "external") {
              pulledHeroImage = imageBlock.external.url;
            } else if (imageBlock.type === "file") {
              pulledHeroImage = imageBlock.file.url;
            }
            if (pulledHeroImage) {
              blocksToConvert = blocksToConvert.slice(1);
            }
          }

          const remoteMarkdownContent = notionBlocksToMarkdown(blocksToConvert);

          // Extract remote props
          const remoteProps: any = { page_id: notionMeta.page_id };
          for (const [key, prop] of Object.entries(data.page.properties) as any) {
            if (prop.type === "title") {
              remoteProps.title = (prop.title || []).map((t: any) => t.plain_text).join("");
            } else if (prop.type === "select") {
              remoteProps[key] = prop.select?.name || "";
            } else if (prop.type === "status") {
              remoteProps[key] = prop.status?.name || "";
            } else if (prop.type === "multi_select") {
              remoteProps[key] = prop.multi_select?.map((s: any) => s.name) || [];
            } else if (prop.type === "rich_text") {
              remoteProps[key] = prop.rich_text[0]?.plain_text || "";
            } else if (prop.type === "url") {
              remoteProps[key] = prop.url || "";
            } else if (prop.type === "checkbox") {
              remoteProps[key] = prop.checkbox || false;
            } else if (prop.type === "date") {
              remoteProps[key] = prop.date?.start || "";
            } else if (prop.type === "number") {
              remoteProps[key] = prop.number || 0;
            }
          }

          const expectedBlocksKey = `notion-expected-blocks-${handle}`;
          const expectedPropsKey = `notion-expected-props-${handle}`;
          const expectedBlocks = localStorage.getItem(expectedBlocksKey);
          const expectedPropsStr = localStorage.getItem(expectedPropsKey);
          let expectedProps = {};
          if (expectedPropsStr) {
            try {
              expectedProps = JSON.parse(expectedPropsStr);
            } catch (e) {}
          }

          let isOutOfSync = false;

          if (expectedBlocks !== null) {
            if (remoteMarkdownContent.trim() !== expectedBlocks.trim()) {
              isOutOfSync = true;
            }
          } else {
            let localContent = "";
            if (lastSyncedMarkdown) {
              const parsed = parseFrontmatter(lastSyncedMarkdown);
              localContent = parsed.content;
            }
            if (remoteMarkdownContent.trim() !== localContent.trim()) {
              isOutOfSync = true;
            }
          }

          // deep equal for expectedProps vs remoteProps
          const arePropsEqual = (a: any, b: any) => {
            const keysA = Object.keys(a).filter(k => a[k] !== "" && a[k] !== false && !(Array.isArray(a[k]) && a[k].length === 0));
            const keysB = Object.keys(b).filter(k => b[k] !== "" && b[k] !== false && !(Array.isArray(b[k]) && b[k].length === 0));

            const allKeys = new Set([...keysA, ...keysB]);
            for (const key of allKeys) {
              let valA = a[key];
              let valB = b[key];
              if (Array.isArray(valA) && Array.isArray(valB)) {
                if (valA.length !== valB.length || valA.some((v, i) => v !== valB[i])) return false;
              } else if (valA !== valB) {
                return false;
              }
            }
            return true;
          };

          if (expectedPropsStr !== null && !arePropsEqual(expectedProps, remoteProps)) {
            isOutOfSync = true;
          }

          if (isOutOfSync) {
            setIsDataSynced(false);
          }

          localStorage.setItem(lastEditedStorageKey, remoteLastEdited);
        } catch (err) {
          console.error("Failed to verify Notion changes", err);
        }
      };

      verifyChange();
    } else if (!localLastEdited) {
      localStorage.setItem(lastEditedStorageKey, remoteLastEdited);
    }
  }, [pageMeta, notionMeta.page_id, lastSyncedMarkdown, lastEditedStorageKey]);

  const isLoading = isSchemaLoading || isPagesLoading;
  const schema = schemaRes?.properties || null;
  const pages = Array.isArray(pagesRes) ? pagesRes : [];

  // Filter and sort pages
  const filteredAndSortedPages = pages
    .filter((p: any) => {
      if (!searchQuery.trim()) return true;
      const titleObj = p.properties?.Topic?.title || p.properties?.Name?.title || p.properties?.Title?.title;
      const pageTitle = titleObj?.[0]?.plain_text || "Untitled";
      const pubUrl = p.properties?.["Published URL"]?.url || p.properties?.["URL"]?.url || "";
      const searchLower = searchQuery.toLowerCase();
      return (
        pageTitle.toLowerCase().includes(searchLower) ||
        pubUrl.toLowerCase().includes(searchLower)
      );
    })
    .sort((a: any, b: any) => {
      // Sort by last_edited_time in descending order (most recent first)
      const timeA = a.last_edited_time || "";
      const timeB = b.last_edited_time || "";
      return timeB.localeCompare(timeA);
    });

  // Show error if needed
  useEffect(() => {
    if (schemaRes?.error || pagesRes?.error) {
      const errorMsg = schemaRes?.error || pagesRes?.error;
      toast.error(`Notion Error: ${errorMsg}\n\nPlease make sure the Content Calendar database is shared with your Notion integration!`);
    }
  }, [schemaRes, pagesRes]);

  // Handle auto-linking
  useEffect(() => {
    if (isLoading || !pagesRes || pagesRes.error) return;

    const existingPageId = notionMeta.page_id;
    const pagesArray = Array.isArray(pagesRes) ? pagesRes : [];
    const pageExists = existingPageId && pagesArray.some(p => p.id === existingPageId);

    // Auto-link if we don't have a page_id, OR if the current page_id is not found in the Notion DB
    // (e.g., if it was archived during a previous push but the frontend didn't save the new ID)
    if (!existingPageId || !pageExists) {
      const expectedUrl = notionMeta["Published URL"] || notionMeta["URL"];
      const cleanHandle = handle.trim().toLowerCase();

      const match = pagesArray.find(p => {
        const pubUrl = (p.properties?.["Published URL"]?.url || p.properties?.["URL"]?.url || "").trim().toLowerCase();

        // First try matching exactly with the known URL from frontmatter
        if (pubUrl && expectedUrl && pubUrl === expectedUrl.trim().toLowerCase()) return true;

        // Fallback to matching handle in the URL
        if (pubUrl && pubUrl.includes(cleanHandle)) return true;

        // Enhance auto-linking: check if the Notion page title loosely matches the project slug or handle
        const titleObj = p.properties?.Topic?.title || p.properties?.Name?.title || p.properties?.Title?.title;
        const pageTitle = (titleObj?.[0]?.plain_text || "").trim().toLowerCase();

        if (pageTitle) {
          const pageTitleSlug = pageTitle.replace(/[^a-z0-9]+/g, '-');
          if (pageTitleSlug.includes(cleanHandle) || cleanHandle.includes(pageTitleSlug)) {
            return true;
          }
        }

        return false;
      });

      if (match) {
        // Only update if the matched ID is different from what we already have
        // This prevents unnecessary saves/onChange calls
        if (match.id !== existingPageId) {
          onChange(updateNotionMetadata(markdown, { page_id: match.id }));
        }
      }
      // REMOVED: We no longer auto-clear the page_id if it's not found in the DB query.
      // Notion's search index can take 10+ seconds to update after creating a new page during a push.
      // If we auto-clear it, it instantly unlinks valid pages right after pushing.
    }
  }, [isLoading, pagesRes, handle, notionMeta.page_id, notionMeta["Published URL"], notionMeta["URL"]]); // Intentionally not including markdown/onChange to avoid loops

  const autoSync = notionMeta.auto_sync === true || notionMeta.auto_sync === "true";

  const handlePull = async () => {
    if (!notionMeta.page_id) {
      toast.error("No Notion Page ID found in frontmatter. Please link to a page first.");
      return;
    }
    
    setIsPulling(true);
    try {
      const res = await authFetch("/api/notion/fetch-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: notionMeta.page_id }),
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // Extract properties
      const newProps: any = { page_id: notionMeta.page_id };
      for (const [key, prop] of Object.entries(data.page.properties) as any) {
        if (prop.type === "title") {
          newProps.title = (prop.title || []).map((t: any) => t.plain_text).join("");
        } else if (prop.type === "select") {
          newProps[key] = prop.select?.name || "";
        } else if (prop.type === "status") {
          newProps[key] = prop.status?.name || "";
        } else if (prop.type === "multi_select") {
          newProps[key] = prop.multi_select?.map((s: any) => s.name) || [];
        } else if (prop.type === "rich_text") {
          newProps[key] = prop.rich_text[0]?.plain_text || "";
        } else if (prop.type === "url") {
          newProps[key] = prop.url || "";
        } else if (prop.type === "checkbox") {
          newProps[key] = prop.checkbox || false;
        } else if (prop.type === "date") {
          newProps[key] = prop.date?.start || "";
        } else if (prop.type === "number") {
          newProps[key] = prop.number || 0;
        }
      }

      let blocksToConvert = data.blocks;
      let pulledHeroImage: string | null = null;
      if (blocksToConvert && blocksToConvert.length > 0 && blocksToConvert[0].type === "image") {
        const imageBlock = blocksToConvert[0].image;
        if (imageBlock.type === "external") {
          pulledHeroImage = imageBlock.external.url;
        } else if (imageBlock.type === "file") {
          pulledHeroImage = imageBlock.file.url;
        }

        if (pulledHeroImage) {
           blocksToConvert = blocksToConvert.slice(1);
        }
      }

      // Convert blocks to markdown, prepend page title as H1
      let newMarkdownContent = notionBlocksToMarkdown(blocksToConvert);
      const pulledTitle = newProps.title;
      if (pulledTitle) {
        newMarkdownContent = `# ${pulledTitle}\n\n${newMarkdownContent}`;
      }

      const expectedBlocksKey = `notion-expected-blocks-${handle}`;
      const expectedPropsKey = `notion-expected-props-${handle}`;
      localStorage.setItem(expectedBlocksKey, newMarkdownContent);
      localStorage.setItem(expectedPropsKey, JSON.stringify(newProps));

      // Update frontmatter
      let updatedFm = updateNotionMetadata(markdown, newProps);
      if (pulledHeroImage) {
        updatedFm = updateHeroImage(updatedFm, pulledHeroImage);
      }

      // Replace content
      const lines = updatedFm.split('\n');
      const fmEndIndex = lines.indexOf('---', 1);
      let newStr = "";
      if (fmEndIndex !== -1) {
        newStr = lines.slice(0, fmEndIndex + 1).join('\n') + '\n\n' + newMarkdownContent;
      } else {
        newStr = newMarkdownContent;
      }

      const finalMarkdown = newStr;

      lastPullMarkdownRef.current = finalMarkdown;
      setLastSyncedMarkdown(finalMarkdown);
      onChange(finalMarkdown);

      if (data.page?.last_edited_time) {
        localStorage.setItem(lastEditedStorageKey, data.page.last_edited_time);
      }

      // Wait for React state to settle, then enforce synced state
      setTimeout(() => setIsDataSynced(true), 50);
      toast.success("Successfully pulled from Notion!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to pull from Notion");
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = useCallback(({ silent = false }: { silent?: boolean } = {}) => {
    const initialMarkdown = markdown;
    setLastSyncedMarkdown(initialMarkdown);
    setIsDataSynced(true);
    setIsPushing(true);

    const pushTask = async () => {
      let currentMarkdown = initialMarkdown;

      // Find local images and upload them first
      const imageRegex = /!\[([^\]]*)\]\((?!http|https|data:)([^)]+)\)/g;
      let match;
      const localImages = [];
      while ((match = imageRegex.exec(currentMarkdown)) !== null) {
        localImages.push({ full: match[0], alt: match[1], url: match[2] });
      }

      if (localImages.length > 0 && !isConnected) {
        setIsDataSynced(false);
        throw new Error("Cannot upload local images because Builder.io is not connected.");
      }

      for (const img of localImages) {
        // Clean path to get filename
        const filename = img.url.split('/').pop() || img.url;
        const res = await authFetch(`/api/projects/${projectSlug}/media/${filename}`);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], filename, { type: blob.type });
          const uploadedUrl = await uploadImageMutation.mutateAsync(file);

          // Replace in markdown
          currentMarkdown = currentMarkdown.replace(img.full, `![${img.alt}](${uploadedUrl})`);
        }
      }

      // If we uploaded images, save the new markdown so it persists
      if (currentMarkdown !== initialMarkdown) {
        onChange(currentMarkdown);
        setLastSyncedMarkdown(currentMarkdown);
      }

      const parsedMd = parseFrontmatter(currentMarkdown);

      // Extract the leading H1 to use as the Notion page title, then strip it from content
      // (Notion shows the page title as a property, so including it as an H1 block would duplicate it)
      const h1Match = parsedMd.content.match(/^#\s+(.+)/);
      const contentTitle = h1Match ? h1Match[1].trim() : null;
      let contentToConvert = parsedMd.content.replace(/^#\s+.+\n*/, '');

      // If there's a hero image in the frontmatter, prepend it to the content before converting to blocks
      const heroImage = parsedMd.data.hero_image || parsedMd.data.builder?.image;
      if (heroImage) {
        contentToConvert = `![](${heroImage})\n\n${contentToConvert}`;
      }

      const blocks = markdownToNotionBlocks(contentToConvert);

      // We will need to map our simple notionMeta properties back to Notion property format
      const notionProps: any = {};
      const isBlogArticle = builderMeta.model === "blog-article";

      if (schema && isBlogArticle) {
        // Blog content: map all schema properties from the content calendar DB
        const titlePropEntry = Object.entries(schema).find(([_, p]: any) => p.type === "title");
        if (titlePropEntry) {
          notionProps[titlePropEntry[0]] = {
            title: [
              {
                text: { content: contentTitle || notionMeta.title || title }
              }
            ]
          };
        }

        // Always ensure Published URL matches our handle URL if pushing and the property exists
        const pubUrlKey = Object.keys(schema).find(k => k === "Published URL" || k === "URL" || k.toLowerCase() === "published url");
        if (pubUrlKey && schema[pubUrlKey].type === "url") {
          notionProps[pubUrlKey] = { url: `https://www.builder.io/blog/${handle}` };
        }

        for (const [key, schemaProp] of Object.entries(schema) as any) {
          if (schemaProp.type === "title") continue;
          if (key === pubUrlKey) continue;

          const val = notionMeta[key];
          if (val === undefined || val === "") continue;

          if (schemaProp.type === "select") {
            notionProps[key] = { select: { name: val } };
          } else if (schemaProp.type === "status") {
            notionProps[key] = { status: { name: val } };
          } else if (schemaProp.type === "multi_select") {
            notionProps[key] = { multi_select: (Array.isArray(val) ? val : [val]).map((v: string) => ({ name: v })) };
          } else if (schemaProp.type === "rich_text") {
            notionProps[key] = { rich_text: [{ text: { content: val } }] };
          } else if (schemaProp.type === "url") {
            notionProps[key] = { url: val };
          } else if (schemaProp.type === "checkbox") {
            notionProps[key] = { checkbox: val === "true" || val === true };
          } else if (schemaProp.type === "date") {
            notionProps[key] = { date: { start: val } };
          } else if (schemaProp.type === "number") {
            notionProps[key] = { number: Number(val) };
          }
        }
      } else {
        // Standalone page: only set the title from H1 content
        const pushTitle = contentTitle || notionMeta.title || title;
        if (pushTitle) {
          notionProps.title = {
            title: [{ text: { content: pushTitle } }]
          };
        }
      }

      const res = await authFetch("/api/notion/push-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: notionMeta.page_id,
          properties: notionProps,
          blocks: blocks
        }),
      });
      const data = await res.json();
      if (data.error) {
        setIsDataSynced(false);
        throw new Error(data.error);
      }

      let blocksToConvertWithoutHero = blocks;
      if (heroImage && blocks.length > 0 && blocks[0].type === "image") {
          blocksToConvertWithoutHero = blocks.slice(1);
      }
      const expectedRemoteBlocks = notionBlocksToMarkdown(blocksToConvertWithoutHero);

      const expectedProps: any = { page_id: data.pageId || notionMeta.page_id };
      expectedProps.title = notionMeta.title || title;
      if (schema && isBlogArticle) {
        const pubUrlKey = Object.keys(schema).find(k => k === "Published URL" || k === "URL" || k.toLowerCase() === "published url");
        if (pubUrlKey && schema[pubUrlKey].type === "url") {
          expectedProps[pubUrlKey] = `https://www.builder.io/blog/${handle}`;
        }

        for (const [key, schemaProp] of Object.entries(schema) as any) {
          if (schemaProp.type === "title" || key === pubUrlKey) continue;

          const val = notionMeta[key];
          if (val === undefined || val === "") continue;

          if (schemaProp.type === "select") {
            expectedProps[key] = val;
          } else if (schemaProp.type === "status") {
            expectedProps[key] = val;
          } else if (schemaProp.type === "multi_select") {
            expectedProps[key] = Array.isArray(val) ? val : [val];
          } else if (schemaProp.type === "rich_text") {
            expectedProps[key] = val;
          } else if (schemaProp.type === "url") {
            expectedProps[key] = val;
          } else if (schemaProp.type === "checkbox") {
            expectedProps[key] = val === "true" || val === true;
          } else if (schemaProp.type === "date") {
            expectedProps[key] = val;
          } else if (schemaProp.type === "number") {
            expectedProps[key] = Number(val);
          }
        }
      }

      localStorage.setItem(`notion-expected-props-${handle}`, JSON.stringify(expectedProps));
      localStorage.setItem(`notion-expected-blocks-${handle}`, expectedRemoteBlocks);

      let finalMarkdown = currentMarkdown;

      // Always update the page_id if it changed (e.g., due to page recreation)
      if (data.pageId && notionMeta.page_id !== data.pageId) {
        finalMarkdown = updateNotionMetadata(currentMarkdown, { page_id: data.pageId });
        onChange(finalMarkdown);
      }

      setLastSyncedMarkdown(finalMarkdown);
      setIsDataSynced(true);

      if (data.last_edited_time) {
        localStorage.setItem(lastEditedStorageKey, data.last_edited_time);
      }

      return data;
    };

    if (silent) {
      onSyncStatusChange?.('syncing');
      pushTask()
        .then(() => onSyncStatusChange?.('synced'))
        .catch(() => toast.error('Failed to sync to Notion'))
        .finally(() => {
          setIsPushing(false);
          setTimeout(() => onSyncStatusChange?.('idle'), 1500);
        });
    } else {
      toast.promise(pushTask().finally(() => setIsPushing(false)), {
        loading: "Pushing to Notion...",
        success: "Successfully pushed to Notion!",
        error: (err) => `Failed to push to Notion: ${err.message}`
      });
    }
  }, [markdown, notionMeta, schema, title, handle, projectSlug, isConnected]);

  const updateProp = (key: string, val: any) => {
    const newMarkdown = updateNotionMetadata(markdown, { [key]: val });
    onChange(newMarkdown);
    // Don't update lastSyncedMarkdown here because changing a prop explicitly means we have local pending changes
    setIsDataSynced(false);
  };

  // --- Auto-pull on mount ---
  // Only pull if there are NO pending local changes. If local is ahead, push instead.
  useEffect(() => {
    if (!autoSync || !notionMeta.page_id || hasAutoPulledRef.current || isPulling || isPushing) return;
    hasAutoPulledRef.current = true;
    if (isDataSynced) {
      // No local changes — safe to pull latest from Notion
      handlePull();
    }
    // If !isDataSynced, skip pull — the auto-push effect below will handle pushing local changes
  }, [autoSync, notionMeta.page_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-push on edit (debounced) ---
  useEffect(() => {
    if (!autoSync || !notionMeta.page_id || isDataSynced || isPulling || isPushing) return;
    // Don't auto-push if the markdown just came from a pull
    if (lastPullMarkdownRef.current !== null && markdown === lastPullMarkdownRef.current) return;

    const timer = setTimeout(() => {
      handlePush({ silent: true });
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoSync, notionMeta.page_id, isDataSynced, isPulling, isPushing, markdown, handlePush]);

  // Because we modify the markdown right before pushing to inject the new page_id
  // but onChange takes a tick to propagate through React state, we also want to track
  // the exact string we just asked the editor to set so we don't immediately mark
  // out of sync when that string arrives in the next render cycle.
  // We use localStorage to persist this state across sidebar closes/opens

  // Keep localStorage in sync with our state
  useEffect(() => {
    if (lastSyncedMarkdown && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, lastSyncedMarkdown);
    }
  }, [lastSyncedMarkdown, storageKey]);

  // Use react-query to cache the schema and pages

  // Handle initialization of sync state on mount explicitly against localStorage,
  // bypassing any React state delays
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (notionMeta.page_id && stored !== null && markdown === stored) {
        setIsDataSynced(true);
      }
    }
  }, []); // Run once on mount

  // When markdown changes, mark out of sync ONLY if it actually differs from what we just synced
  useEffect(() => {
    // Only mark out of sync if we actually have a Notion page linked,
    // and we aren't currently pulling
    if (notionMeta.page_id && !isPulling) {
      // Check both state and localStorage directly to avoid state race conditions on mount
      let currentlySynced = lastSyncedMarkdown;
      if (currentlySynced === null && typeof window !== 'undefined') {
        currentlySynced = localStorage.getItem(storageKey);
      }

      if (currentlySynced !== null && markdown === currentlySynced) {
        setIsDataSynced(true);
      } else {
        // Double check against exact string comparison to prevent tiny parser whitespace differences
        // from instantly breaking sync state on re-mounts
        setIsDataSynced(false);
      }
    }
  }, [markdown, notionMeta.page_id, isPulling, lastSyncedMarkdown, storageKey]);

  // In autoSyncOnly mode, all hooks have already run above — just skip rendering UI
  if (autoSyncOnly) return null;

  return (
    <div className="flex flex-col h-full bg-background">
      {isLoading ? (
        <div className="flex-1 flex justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-4">
              {(schemaRes?.error || pagesRes?.error) ? (
                <div className="p-4 bg-destructive/10 text-destructive text-sm rounded-md space-y-2 border border-destructive/20">
                  <p className="font-semibold flex items-center gap-2"><ExternalLink className="w-4 h-4" /> Failed to connect to Notion</p>
                  <p className="opacity-90">{schemaRes?.error || pagesRes?.error}</p>
                  <p className="text-xs mt-2 opacity-80">Please check your Notion API key and ensure the database is shared with your integration.</p>
                  <Button variant="outline" size="sm" className="mt-2 bg-background/50 hover:bg-background/80 text-foreground" onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ['notion-schema'] });
                    queryClient.invalidateQueries({ queryKey: ['notion-pages'] });
                  }}>
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Retry Connection
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Linked Notion Page</Label>

                    {notionMeta.page_id && !showPageSelector ? (
                      // Compact selected state
                      <div className="border rounded-md bg-accent/30 p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-medium text-sm">{(() => {
                                const selectedPage = pages.find((p: any) => p.id === notionMeta.page_id);
                                if (selectedPage) {
                                  const titleObj = selectedPage.properties?.Topic?.title || selectedPage.properties?.Name?.title || selectedPage.properties?.Title?.title;
                                  return titleObj?.[0]?.plain_text || "Untitled";
                                }
                                return notionMeta.title || "Linked Page";
                              })()}</span>
                              {(() => {
                                const selectedPage = pages.find((p: any) => p.id === notionMeta.page_id);
                                const pubUrl = selectedPage?.properties?.["Published URL"]?.url || selectedPage?.properties?.["URL"]?.url || "";
                                return pubUrl && (
                                  <span className="text-xs text-muted-foreground truncate">{pubUrl}</span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowPageSelector(true)}
                            className="h-7 text-xs"
                          >
                            Change Page
                          </Button>
                          <a
                            href={`https://www.notion.so/${notionMeta.page_id.replace(/-/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 font-medium"
                          >
                            Open in Notion <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      // Full search/selection interface
                      <>
                        <Input
                          placeholder="Search Notion pages..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-8 text-sm"
                        />
                        <div className="border rounded-md bg-background max-h-48 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => {
                              onChange(updateNotionMetadata(markdown, { page_id: undefined }));
                              setSearchQuery("");
                              setShowPageSelector(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b",
                              !notionMeta.page_id && "bg-accent font-medium"
                            )}
                          >
                            -- Create New Page --
                          </button>
                          {filteredAndSortedPages.length === 0 && searchQuery.trim() ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                              No pages found
                            </div>
                          ) : (
                            filteredAndSortedPages.map((p: any) => {
                              const titleObj = p.properties?.Topic?.title || p.properties?.Name?.title || p.properties?.Title?.title;
                              const pageTitle = titleObj?.[0]?.plain_text || "Untitled";
                              const pubUrl = p.properties?.["Published URL"]?.url || p.properties?.["URL"]?.url || "";
                              const isSelected = notionMeta.page_id === p.id;

                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    onChange(updateNotionMetadata(markdown, { page_id: p.id }));
                                    setSearchQuery("");
                                    setShowPageSelector(false);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0",
                                    isSelected && "bg-accent font-medium"
                                  )}
                                >
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{pageTitle}</span>
                                    {pubUrl && (
                                      <span className="text-xs text-muted-foreground truncate">{pubUrl}</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {schema && builderMeta.model === "blog-article" && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Title</Label>
                        <Input
                          className="h-8 text-sm"
                          value={notionMeta.title || title || ""}
                          onChange={(e) => updateProp("title", e.target.value)}
                        />
                      </div>

                      {Object.entries(schema).map(([key, prop]: [string, any]) => {
                    if (prop.type === "title") return null;

                    if (prop.type === "select" || prop.type === "status" || key === "Type") {
                      let val = notionMeta[key];
                      if (Array.isArray(val) && val.length > 0) {
                        val = val[0];
                      }
                      if (!val) val = "none";

                      const options = prop.type === "multi_select" ? prop.multi_select?.options : prop[prop.type]?.options;

                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          <Select
                            value={val}
                            onValueChange={(newVal) => updateProp(key, newVal === "none" ? undefined : newVal)}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder={`Select ${key}...`} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-- None --</SelectItem>
                              {options?.map((opt: any) => (
                                <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    if (prop.type === "multi_select") {
                      const selectedVals = Array.isArray(notionMeta[key])
                        ? notionMeta[key]
                        : (typeof notionMeta[key] === 'string' && notionMeta[key]
                            ? notionMeta[key].split(',').map((s: string) => s.trim()).filter(Boolean)
                            : []);
                      const options = prop.multi_select?.options || [];
                      const availableOptions = options.filter((opt: any) => !selectedVals.includes(opt.name));

                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          {selectedVals.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {selectedVals.map((val: string) => (
                                <span key={val} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                                  {val}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextVals = selectedVals.filter((v: string) => v !== val);
                                      updateProp(key, nextVals);
                                    }}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <Select
                            value="none"
                            onValueChange={(val) => {
                              if (val !== "none") {
                                updateProp(key, [...selectedVals, val]);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder={`Add ${key}...`} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-- Select option --</SelectItem>
                              {availableOptions.map((opt: any) => (
                                <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    if (prop.type === "rich_text") {
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          <Input
                            className="h-8 text-sm"
                            value={notionMeta[key] || ""}
                            onChange={(e) => updateProp(key, e.target.value)}
                          />
                        </div>
                      );
                    }

                    if (prop.type === "url") {
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          <Input
                            className="h-8 text-sm"
                            type="url"
                            value={notionMeta[key] || ""}
                            onChange={(e) => updateProp(key, e.target.value)}
                          />
                        </div>
                      );
                    }

                    if (prop.type === "date") {
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          <Input
                            className="h-8 text-sm"
                            type="date"
                            value={notionMeta[key] || ""}
                            onChange={(e) => updateProp(key, e.target.value)}
                          />
                        </div>
                      );
                    }

                    if (prop.type === "number") {
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key}</Label>
                          <Input
                            className="h-8 text-sm"
                            type="number"
                            value={notionMeta[key] || ""}
                            onChange={(e) => updateProp(key, e.target.value)}
                          />
                        </div>
                      );
                    }

                    if (prop.type === "checkbox") {
                      return (
                        <div key={key} className="flex items-center space-x-2">
                          <Checkbox
                            id={`notion-prop-${key}`}
                            checked={notionMeta[key] === "true" || notionMeta[key] === true}
                            onCheckedChange={(checked) => updateProp(key, checked)}
                          />
                          <Label htmlFor={`notion-prop-${key}`} className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {key}
                          </Label>
                        </div>
                      );
                    }

                    // Simplified handling for other types
                    return null;
                  })}
                    </>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer Actions */}
          <div className="px-4 py-3 border-t border-border shrink-0 bg-background">
            <div className="space-y-3">
              {/* Auto Sync Toggle */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notion-auto-sync"
                  checked={autoSync}
                  onCheckedChange={(checked) => {
                    const newMarkdown = updateNotionMetadata(markdown, { auto_sync: !!checked });
                    onChange(newMarkdown);
                  }}
                />
                <Label htmlFor="notion-auto-sync" className="text-xs font-medium leading-none cursor-pointer">
                  Auto Sync
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  Pull on load, push on edit
                </span>
              </div>

              {!autoSync && (
                <>
                  {!notionMeta.page_id && (
                    <p className="text-xs text-muted-foreground text-center pb-1">
                      Pushing will create a new page in Notion.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      onClick={handlePull}
                      disabled={isPulling || !notionMeta.page_id || isDataSynced}
                      className="w-full relative disabled:opacity-50"
                    >
                      {isPulling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                      Pull from Notion
                    </Button>
                    <Button
                      variant={!isDataSynced || !notionMeta.page_id ? "default" : "outline"}
                      onClick={() => { handlePush(); }}
                      disabled={isPulling || (isDataSynced && !!notionMeta.page_id)}
                      className="w-full relative disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {!isDataSynced && notionMeta.page_id ? "Push updates to Notion" : "Push to Notion"}
                      {(!isDataSynced || !notionMeta.page_id) && (
                         <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-blue-500"></span>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
