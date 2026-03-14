// --- Projects ---

export interface Project {
  slug: string;
  canonicalSlug?: string;
  name: string;
  updatedAt: string;
  group?: string;
  folder?: string;       // intermediate path within workspace (e.g. "blog" or "social/campaigns")
  activeDraft?: string;  // defaults to "draft.md"
  isPrivate?: boolean;
  ownerId?: string;
}

export interface ProjectListResponse {
  projects: Project[];
  groups: string[];
  groupMeta?: Record<string, { prefixed?: boolean }>;
  folders?: Record<string, string[]>; // workspace → folder paths (e.g. {"devrel": ["blog", "social", "social/campaigns"]})
}

export interface UpdateProjectMetaRequest {
  isPrivate?: boolean;
  ownerId?: string;
  activeDraft?: string;
}

export interface ProjectCreateRequest {
  name: string;
  group?: string;
  builderHandle?: string;
  builderDocsId?: string;
  builderModel?: "blog-article" | "docs-content";
  fullData?: any;
  blocksString?: string;
}

export interface ProjectCreateResponse {
  slug: string;
  name: string;
  group?: string;
}

export interface ProjectGroupCreateRequest {
  name: string;
}

export interface ProjectGroupCreateResponse {
  group: string;
  prefixed?: boolean;
}

export interface ProjectMoveRequest {
  group?: string;
}

export interface ProjectMoveResponse {
  slug: string;
  group?: string;
}

// --- File Tree ---

export interface FileNode {
  name: string;
  path: string; // relative path within project, e.g. "resources/research.md"
  type: "file" | "directory";
  title?: string; // extracted from markdown H1
  updatedAt?: string;
  children?: FileNode[];
  isImage?: boolean; // true for image files (png, jpg, webp, etc.)
}

export interface FileTreeResponse {
  tree: FileNode[];
  activeDraftPath?: string;
}

// --- File Content ---

export interface FileContentResponse {
  path: string;
  title: string;
  content: string;
  updatedAt?: string;
}

export interface FileSaveRequest {
  content: string;
}

export interface FileCreateRequest {
  name: string;
  type: "file" | "directory";
  parentPath?: string; // relative path within project, defaults to root
  content?: string;
}

export interface FileCreateResponse {
  path: string;
  name: string;
}

export interface FileSaveResponse {
  success: boolean;
  updatedAt?: string;
}

// --- Version History ---

export type VersionActorType = "user" | "agent";
export type VersionSource = "autosave" | "agentWrite" | "restore";

export interface VersionHistoryItem {
  id: string;
  timestamp: number;
  actorType: VersionActorType;
  actorId: string;
  actorDisplayName?: string;
  actorEmail?: string;
  source: VersionSource;
  wordsAdded: number;
  wordsRemoved: number;
  linesChanged: number;
  sectionsAffected: string[];
}

export interface VersionHistoryListResponse {
  versions: VersionHistoryItem[];
}

export interface VersionContentResponse extends VersionHistoryItem {
  content: string;
}

export interface RestoreVersionResponse {
  success: boolean;
  path: string;
  title: string;
  content: string;
  updatedAt?: string;
}

// --- Pages (unified tree) ---

export interface Page {
  id: string;              // project slug or "slug::filepath"
  title: string;
  parentId: string | null; // null = top-level in workspace
  type: "page" | "folder"; // folder = expandable group only
  updatedAt: string;
  hasChildren: boolean;
  isPrivate?: boolean;
  // Internal mapping (used by client for CRUD delegation)
  _projectSlug: string;
  _filePath: string | null; // null = project root (activeDraft)
}

export interface PageTreeResponse {
  pages: Page[];
  workspace: string;
}

// --- Keyword Research ---

export interface KeywordSuggestion {
  keyword: string;
  volume?: number;
  cpc?: number;
  competition?: number;
  difficulty?: number;
}

export interface KeywordSuggestResponse {
  query: string;
  suggestions: KeywordSuggestion[];
  source: "autocomplete" | "dataforseo";
}

export interface KeywordVolumeRequest {
  keywords: string[];
  locationCode?: number; // DataForSEO location code, default 2840 (US)
  languageCode?: string; // DataForSEO language code, default "en"
}

export interface KeywordVolumeResponse {
  keywords: KeywordSuggestion[];
}

export interface KeywordApiStatus {
  configured: boolean;
  provider: string;
}

// --- Research ---

export interface ResearchSignal {
  type: "social" | "ranking" | "authority" | "recency" | "engagement";
  label: string;
  value?: string; // exact stat, e.g. "363K", "2.1K", "500+"
}

export interface ResearchArticle {
  id: string;
  title: string;
  source: string;
  author: string;
  url: string;
  publishedDate?: string;
  signals: ResearchSignal[];
  highlights: string[];
  keyQuote?: string;
  summary: string;
}

export interface ResearchData {
  topic: string;
  updatedAt: string;
  articles: ResearchArticle[];
  themes: string[];
}

// --- Image Presets ---

export interface ImagePreset {
  id: string;
  name: string;
  paths: string[];
  instructions?: string;
  createdAt: number;
}

export interface ImagePresetsFile {
  presets: ImagePreset[];
}

// --- Image Generation ---

export type ImageGenModel = "openai" | "gemini" | "flux";

export interface ImageGenRequest {
  prompt: string;
  model: ImageGenModel;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  projectSlug?: string;
  /** Name of a preset folder in shared-resources/image-references/ (e.g. 'hero-images', 'diagrams') */
  preset?: string;
  /** Stable source/reference image inputs to include in every request (absolute URLs, app media URLs, or filesystem paths) */
  referenceImagePaths?: string[];
  /** Base64 data URLs for uploaded reference images that should also be treated as fixed inputs */
  uploadedReferenceImages?: string[];
}

export interface ImageGenResponse {
  url: string;
  model: ImageGenModel;
  prompt: string;
  savedPath?: string;
}

export interface ImageGenStatusResponse {
  openai: boolean;
  gemini: boolean;
  flux: boolean;
}

// --- Image Folders ---

export interface ImageFolder {
  name: string;
  path: string;
  imageCount: number;
  thumbnailPath?: string;
  images: { name: string; path: string }[];
}

export interface ImageFoldersResponse {
  folders: ImageFolder[];
}

// --- Builder.io Integration ---

export interface BuilderBlock {
  "@type": "@builder.io/sdk:Element";
  id?: string;
  component?: {
    name: string;
    options: Record<string, unknown>;
  };
  responsiveStyles?: {
    large?: Record<string, string>;
    medium?: Record<string, string>;
    small?: Record<string, string>;
  };
  children?: BuilderBlock[];
  properties?: Record<string, string>;
}

export interface BuilderArticleData {
  title: string;
  handle: string;
  blurb: string;
  metaTitle?: string;
  date: number;
  readTime: number;
  tags: string[];
  topic: string;
  image?: string;
  hideImage: boolean;
  author?: {
    "@type": "@builder.io/core:Reference";
    id: string;
    model: "blog-author";
  };
  blocksString?: string;
}

export interface BuilderArticleUpload {
  name: string;
  published: "published" | "draft";
  data: BuilderArticleData;
}

export interface BuilderAuthor {
  id: string;
  name: string;
  data: {
    fullName: string;
    photo?: string;
    handle?: string;
  };
}

export interface BuilderExistingArticle {
  id: string;
  name: string;
  lastUpdated?: number;
  data: {
    handle: string;
    title: string;
    tags?: string[];
    topic?: string;
    blurb?: string;
    metaTitle?: string;
    date?: number;
    readTime?: number;
    image?: string;
    hideImage?: boolean;
    blocks?: any[];
    author?: {
      "@type": string;
      id: string;
      model: string;
    };
    authors?: {
      "@type": string;
      id: string;
      model: string;
    }[];
  };
}

export interface BuilderExistingDoc {
  id: string;
  name: string;
  lastUpdated?: number;
  url?: string;
  data: {
    handle?: string;
    url?: string;
    title?: string;
    blocks?: any[];
    [key: string]: any;
  };
}

export interface BuilderAuthorReference {
  "@type": string;
  id: string;
  model: string;
}

export interface BuilderBlogIndexItem {
  id: string;
  handle: string;
  title: string;
  authorIds: string[];
  authorNames: string[];
  publishedAt?: string;
  topic?: string;
  tags: string[];
  linkedProjectSlug?: string;
  linkedProjectName?: string;
  linkedWorkspace?: string;
  inferredWorkspace?: string;
}

export interface BuilderDocsIndexItem {
  id: string;
  url?: string;
  title: string;
  referenceNumber?: string;
  tags: string[];
  redirectToUrl?: string;
  addNoIndex?: boolean;
  linkedProjectSlug?: string;
  linkedProjectName?: string;
  linkedWorkspace?: string;
}

export interface BuilderUploadRequest {
  apiKey: string;
  privateKey: string;
  article: BuilderArticleUpload;
  model?: "blog-article" | "docs-content";
}

export interface BuilderUploadResponse {
  success: boolean;
  id?: string;
  error?: string;
}

// --- Google Search ---

export interface GoogleSearchResult {
  title: string;
  url: string;
  description: string;
  domain: string;
  position: number;
  breadcrumb?: string;
}

export interface GoogleSearchResponse {
  results: GoogleSearchResult[];
  hasNextPage: boolean;
}

export interface GoogleSearchStatus {
  configured: boolean;
  provider: string;
  googleCSE: boolean;
  dataForSEO: boolean;
}

// --- Twitter Research ---

export interface TwitterAuthor {
  id: string;
  userName: string;
  name: string;
  profilePicture?: string;
  isBlueVerified?: boolean;
  followers?: number;
}

export interface TwitterMedia {
  type: string; // "photo", "video", "animated_gif"
  url: string;
  thumbnailUrl?: string;
}

export interface TwitterTweet {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  lang?: string;
  type?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount: number;
  bookmarkCount: number;
  media?: TwitterMedia[];
  author: TwitterAuthor;
  isReply?: boolean;
  quotedTweet?: TwitterTweet;
  article?: {
    title: string;
    previewText: string;
    coverImageUrl: string;
  };
}

export interface TwitterSearchResponse {
  tweets: TwitterTweet[];
  nextCursor?: string;
  hasNextPage: boolean;
}

export interface TwitterArticle {
  title: string;
  previewText?: string;
  coverImageUrl?: string;
  contents?: string;
}

export interface TwitterSaveRequest {
  projectSlug?: string;
  newProjectName?: string;
  newProjectGroup?: string;
  query: string;
  tweets: TwitterTweet[];
}

export interface TwitterSaveResponse {
  success: boolean;
  projectSlug: string;
  filePath: string;
}

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image?: string;
  domain: string;
  status?: number; // HTTP status code (e.g. 200, 404)
}

export interface CollectedLink {
  url: string;
  title: string;
  description: string;
  domain: string;
  image?: string;
  tweetId: string;
  tweetAuthor: string;
  tweetText: string;
  /** Raw HTML from the webview, used for direct markdown conversion */
  html?: string;
}
