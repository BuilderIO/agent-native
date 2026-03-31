// ── Jira API types ──

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: {
    "48x48"?: string;
    "32x32"?: string;
    "24x24"?: string;
    "16x16"?: string;
  };
  active?: boolean;
}

export interface JiraStatusCategory {
  id: number;
  key: "new" | "indeterminate" | "done" | "undefined";
  name: string;
  colorName: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: JiraStatusCategory;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
  subtask?: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrls?: {
    "48x48"?: string;
    "32x32"?: string;
    "24x24"?: string;
    "16x16"?: string;
  };
  projectTypeKey?: string;
  style?: string;
  lead?: JiraUser;
}

export interface JiraIssue {
  id: string;
  key: string;
  self?: string;
  fields: {
    summary: string;
    description?: unknown; // ADF document
    status: JiraStatus;
    priority?: JiraPriority;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    issuetype: JiraIssueType;
    project: JiraProject;
    labels?: string[];
    created?: string;
    updated?: string;
    resolutiondate?: string;
    resolution?: { name: string } | null;
    parent?: {
      id: string;
      key: string;
      fields: {
        summary: string;
        status: JiraStatus;
        issuetype: JiraIssueType;
      };
    };
    subtasks?: Array<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status: JiraStatus;
        issuetype: JiraIssueType;
        priority?: JiraPriority;
      };
    }>;
    issuelinks?: Array<{
      id: string;
      type: { name: string; inward: string; outward: string };
      inwardIssue?: {
        id: string;
        key: string;
        fields: {
          summary: string;
          status: JiraStatus;
          issuetype: JiraIssueType;
        };
      };
      outwardIssue?: {
        id: string;
        key: string;
        fields: {
          summary: string;
          status: JiraStatus;
          issuetype: JiraIssueType;
        };
      };
    }>;
    comment?: {
      total: number;
      comments: JiraComment[];
    };
    sprint?: JiraSprint | null;
    [key: string]: unknown;
  };
  changelog?: {
    histories: JiraHistory[];
  };
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown; // ADF document
  created: string;
  updated: string;
  updateAuthor?: JiraUser;
}

export interface JiraHistory {
  id: string;
  author: JiraUser;
  created: string;
  items: Array<{
    field: string;
    fieldtype: string;
    from: string | null;
    fromString: string | null;
    to: string | null;
    toString: string | null;
  }>;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: "scrum" | "kanban" | "simple";
  location?: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

export interface JiraBoardColumn {
  name: string;
  statuses: Array<{ id: string; self: string }>;
}

export interface JiraBoardConfig {
  id: number;
  name: string;
  columnConfig: {
    columns: JiraBoardColumn[];
  };
}

// ── App types ──

export interface NavigationState {
  view: string;
  issueKey?: string;
  projectKey?: string;
  boardId?: string;
  sprintId?: string;
  search?: string;
  focusedIssueKey?: string;
}

export interface JiraAuthStatus {
  connected: boolean;
  email?: string;
  cloudId?: string;
  cloudName?: string;
  avatarUrl?: string;
}

export interface IssueListParams {
  view?: string;
  projectKey?: string;
  boardId?: string;
  sprintId?: string;
  jql?: string;
  q?: string;
  nextPageToken?: string;
  maxResults?: number;
}
