import { parse, stringify } from "yaml";

export interface BuilderMetadata {
  model?: "blog-article" | "docs-content";
  // Blog article fields
  title?: string;
  handle?: string;
  blurb?: string;
  metaTitle?: string;
  date?: string | Date;
  readTime?: number;
  tags?: string[];
  topic?: string;
  image?: string;
  hideImage?: boolean;
  authorId?: string;
  // Docs content fields
  docsId?: string;
  url?: string;
  pageTitle?: string;
  description?: string;
  hideNav?: boolean;
  shopifyApplicable?: boolean;
  referenceNumber?: string;
  redirectToUrl?: string;
  redirectToPermanent?: boolean;
  hideFeedbackColumn?: boolean;
  showToc?: boolean;
  addNoIndex?: boolean;
}

export interface FrontmatterData {
  hero_image?: string;
  builder?: BuilderMetadata;
  notion?: any;
  [key: string]: any;
}

export interface ParsedMarkdown {
  content: string;
  data: FrontmatterData;
  original: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;

/**
 * Parse markdown with YAML frontmatter
 */
export function parseFrontmatter(markdown: string): ParsedMarkdown {
  if (!markdown) {
    return { content: "", data: {}, original: "" };
  }

  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return { content: markdown, data: {}, original: markdown };
  }

  try {
    const data = parse(match[1]) || {};
    // Trim leading newlines from content to prevent newline accumulation
    const content = markdown.slice(match[0].length).replace(/^\r?\n+/, "");
    return {
      content,
      data: data as FrontmatterData,
      original: markdown,
    };
  } catch (e) {
    console.error("Failed to parse frontmatter", e);
    return { content: markdown, data: {}, original: markdown };
  }
}

/**
 * Update frontmatter data and reconstruct the markdown
 */
export function updateFrontmatter(
  markdown: string,
  updates: Partial<FrontmatterData>
): string {
  const parsed = parseFrontmatter(markdown);

  // Create a deep copy of parsed data to avoid mutating references
  const newData = JSON.parse(JSON.stringify(parsed.data));

  // Apply updates (this only handles top-level keys for now, but builder is handled specially below)
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) {
      delete newData[k];
    } else {
      newData[k] = v;
    }
  }

  // Also remove top level undefined
  for (const key of Object.keys(newData)) {
    if (newData[key] === undefined) {
      delete newData[key];
    }
  }

  if (Object.keys(newData).length === 0) {
    return parsed.content;
  }

  const yamlStr = stringify(newData);
  return `---\n${yamlStr}---\n\n${parsed.content}`;
}

/**
 * Update Builder metadata specifically
 */
export function updateBuilderMetadata(
  markdown: string,
  builderUpdates: Partial<BuilderMetadata>
): string {
  const parsed = parseFrontmatter(markdown);
  const currentBuilder = (parsed.data.builder || {}) as BuilderMetadata;
  
  const newBuilder = { ...currentBuilder };

  // Apply updates (if undefined, delete the key)
  for (const [k, v] of Object.entries(builderUpdates)) {
    if (v === undefined) {
      delete (newBuilder as any)[k];
    } else {
      (newBuilder as any)[k] = v;
    }
  }
  
  // Remove if completely empty
  if (Object.keys(newBuilder).length === 0) {
    const newData = { ...parsed.data };
    delete newData.builder;
    return updateFrontmatter(markdown, newData);
  }

  return updateFrontmatter(markdown, { builder: newBuilder });
}

/**
 * Update Notion metadata specifically
 */
export function updateNotionMetadata(
  markdown: string,
  notionUpdates: Partial<any>
): string {
  const parsed = parseFrontmatter(markdown);
  const currentNotion = (parsed.data.notion || {});

  const newNotion = { ...currentNotion };

  // Apply updates (if undefined, delete the key)
  for (const [k, v] of Object.entries(notionUpdates)) {
    if (v === undefined) {
      delete newNotion[k];
    } else {
      newNotion[k] = v;
    }
  }

  // Remove if completely empty
  if (Object.keys(newNotion).length === 0) {
    const newData = { ...parsed.data };
    delete newData.notion;
    return updateFrontmatter(markdown, newData);
  }

  return updateFrontmatter(markdown, { notion: newNotion });
}

/**
 * Get Notion metadata from frontmatter
 */
export function getNotionMetadata(markdown: string): any {
  const parsed = parseFrontmatter(markdown);
  return parsed.data.notion || {};
}

/**
 * Get Builder metadata from frontmatter
 */
export function getBuilderMetadata(markdown: string): BuilderMetadata {
  const parsed = parseFrontmatter(markdown);
  return parsed.data.builder || {};
}

/**
 * Get hero image from frontmatter (legacy field for backwards compatibility)
 */
export function getHeroImage(markdown: string): string | null {
  const parsed = parseFrontmatter(markdown);
  return (parsed.data.builder?.image !== undefined ? parsed.data.builder.image : parsed.data.hero_image) ?? null;
}

/**
 * Update hero image in frontmatter
 */
export function updateHeroImage(
  markdown: string,
  heroImage: string | null
): string {
  const parsed = parseFrontmatter(markdown);
  // Deep clone to ensure nested objects like .builder aren't just referenced
  const newData = JSON.parse(JSON.stringify(parsed.data));

  if (heroImage) {
    newData.hero_image = heroImage;
    if (newData.builder) {
      newData.builder.image = heroImage;
    }
  } else {
    // Write empty string instead of deleting
    newData.hero_image = "";
    if (newData.builder) {
      newData.builder.image = "";
    }
  }

  // Pass the fully constructed newData directly back
  const yamlStr = stringify(newData);
  return `---\n${yamlStr}---\n\n${parsed.content}`;
}
