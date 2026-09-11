export interface FileResult {
  path: string;
  name: string;
  source: "codebase" | "resource";
  type: "file" | "folder";
}

export interface SkillResult {
  name: string;
  description: string;
  path: string;
  source: "codebase" | "resource";
}

export type MentionItemMedia =
  | {
      type: "text";
      /** Short text shown inside the media frame, such as an emoji or initials. */
      text: string;
      /** Optional CSS color used behind the text. */
      backgroundColor?: string;
    }
  | {
      type: "image";
      /** Image URL shown inside the media frame. Relative URLs are supported. */
      src: string;
      /** How the image fits the frame. Defaults to contain. */
      fit?: "contain" | "cover";
      /** Optional CSS color visible behind contained images. */
      backgroundColor?: string;
    }
  | { type: "none" };

export interface MentionItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  /** Optional presentation that takes precedence over the legacy icon. */
  media?: MentionItemMedia;
  source: string;
  refType: string;
  refPath?: string;
  refId?: string;
  section?: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: MentionReferenceInsert[];
}

export interface Reference {
  type: "file" | "skill" | "mention" | "agent" | "custom-agent";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
}

export interface MentionReferenceInsert {
  label: string;
  icon?: string;
  /** Optional presentation that takes precedence over the legacy icon. */
  media?: MentionItemMedia;
  source?: string;
  refType: string;
  refId?: string | null;
  refPath?: string | null;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: MentionReferenceInsert[];
}

export interface SlashCommand {
  name: string;
  description: string;
  icon?: string;
}

export type ComposerMode = "skill" | "job" | "automation" | "extension";

export type AgentComposerLayoutVariant = "default" | "compact" | "hero";
