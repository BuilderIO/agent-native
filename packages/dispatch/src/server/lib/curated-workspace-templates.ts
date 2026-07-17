import { listWorkspaceApps } from "./app-creation-store.js";

export interface CuratedWorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  template: string;
  liveUrl: string;
  category: string;
  setupNote: string;
}

export interface CuratedWorkspaceTemplateStatus extends CuratedWorkspaceTemplate {
  installed: boolean;
}

/**
 * Stable first-party template metadata for the initial remix catalog.
 * `liveUrl` identifies the product URL; it is not a public-demo claim.
 */
export const CURATED_WORKSPACE_TEMPLATES: readonly CuratedWorkspaceTemplate[] =
  [
    {
      id: "mail",
      name: "Mail",
      description:
        "Agent-native email client with keyboard shortcuts and AI triage.",
      icon: "Mail",
      color: "#3B82F6",
      template: "mail",
      liveUrl: "https://mail.agent-native.com",
      category: "communication",
      setupNote:
        "Connect the workspace email integration before working with live mail.",
    },
    {
      id: "calendar",
      name: "Calendar",
      description:
        "Manage events, synchronization, and public booking with an agent-native calendar.",
      icon: "CalendarDays",
      color: "#00B5FF",
      template: "calendar",
      liveUrl: "https://calendar.agent-native.com",
      category: "productivity",
      setupNote:
        "Connect the workspace calendar integration before working with live events.",
    },
    {
      id: "analytics",
      name: "Analytics",
      description:
        "Connect data sources and prompt for charts, reports, and product insights.",
      icon: "BarChart2",
      color: "#F59E0B",
      template: "analytics",
      liveUrl: "https://analytics.agent-native.com",
      category: "insights",
      setupNote:
        "Connect a data source or import a representative dataset before analysis.",
    },
    {
      id: "slides",
      name: "Slides",
      description:
        "Generate and edit React presentations with agent assistance.",
      icon: "GalleryHorizontal",
      color: "#EC4899",
      template: "slides",
      liveUrl: "https://slides.agent-native.com",
      category: "creative",
      setupNote:
        "Start with a blank deck or connect the workspace presentation integration.",
    },
    {
      id: "content",
      name: "Content",
      description:
        "Write and organize local MDX content with agent assistance.",
      icon: "FileText",
      color: "#10B981",
      template: "content",
      liveUrl: "https://content.agent-native.com",
      category: "content",
      setupNote:
        "Choose a content folder or create a first document for the private remix.",
    },
    {
      id: "clips",
      name: "Clips",
      description:
        "Record screens, capture meeting notes, and use voice dictation with AI.",
      icon: "ScreenShare",
      color: "#0EA5E9",
      template: "clips",
      liveUrl: "https://clips.agent-native.com",
      category: "media",
      setupNote:
        "Grant screen and audio permissions only when the workspace needs recording.",
    },
    {
      id: "brain",
      name: "Brain",
      description:
        "Search cited company knowledge from conversations, meetings, and decisions.",
      icon: "Brain",
      color: "#8B5CF6",
      template: "brain",
      liveUrl: "https://brain.agent-native.com",
      category: "knowledge",
      setupNote:
        "Connect approved knowledge sources before indexing workspace information.",
    },
    {
      id: "assets",
      name: "Assets",
      description:
        "Upload, organize, search, and generate on-brand images and videos.",
      icon: "Photo",
      color: "#0F766E",
      template: "assets",
      liveUrl: "https://assets.agent-native.com",
      category: "content",
      setupNote:
        "Upload a representative asset or connect approved asset storage to begin.",
    },
    {
      id: "forms",
      name: "Forms",
      description: "Create, edit, and manage forms with agent assistance.",
      icon: "ClipboardList",
      color: "#06B6D4",
      template: "forms",
      liveUrl: "https://forms.agent-native.com",
      category: "operations",
      setupNote:
        "Create a form and choose its submission destination before inviting respondents.",
    },
    {
      id: "design",
      name: "Design",
      description:
        "Create and edit visual designs with agent-assisted exploration.",
      icon: "Brush",
      color: "#F472B6",
      template: "design",
      liveUrl: "https://design.agent-native.com",
      category: "creative",
      setupNote:
        "Create a private project and optionally connect approved asset sources.",
    },
  ] as const;

const curatedTemplateById = new Map(
  CURATED_WORKSPACE_TEMPLATES.map((template) => [template.id, template]),
);

export function getCuratedWorkspaceTemplate(
  templateId: string,
): CuratedWorkspaceTemplate {
  const normalized = templateId.trim().toLowerCase();
  const template = curatedTemplateById.get(normalized);
  if (!template) {
    throw new Error(`Unknown curated workspace template "${templateId}".`);
  }
  return template;
}

export async function listCuratedWorkspaceTemplates(): Promise<
  CuratedWorkspaceTemplateStatus[]
> {
  const installedIds = new Set(
    (
      await listWorkspaceApps({
        includeAgentCards: false,
        includeArchived: true,
      })
    ).map((app) => app.id.trim().toLowerCase()),
  );

  return CURATED_WORKSPACE_TEMPLATES.map((template) => ({
    ...template,
    installed: installedIds.has(template.id),
  }));
}
