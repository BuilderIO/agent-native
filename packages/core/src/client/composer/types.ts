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

export interface MentionItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  source: string;
  refType: string;
  refPath?: string;
  refId?: string;
}

export interface Reference {
  type: "file" | "skill" | "mention";
  path: string;
  name: string;
  source: string;
  refType?: string;
  refId?: string;
}
