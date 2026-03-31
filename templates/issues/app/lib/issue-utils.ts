import type { JiraStatusCategory, JiraIssueType } from "@shared/types";

export function getStatusCategoryColor(category?: JiraStatusCategory) {
  switch (category?.key) {
    case "new":
      return "status-new";
    case "indeterminate":
      return "status-indeterminate";
    case "done":
      return "status-done";
    default:
      return "status-new";
  }
}

export function getStatusCategoryLabel(key?: string) {
  switch (key) {
    case "new":
      return "To Do";
    case "indeterminate":
      return "In Progress";
    case "done":
      return "Done";
    default:
      return "To Do";
  }
}

export function getIssueTypeIcon(type?: JiraIssueType): string {
  if (!type) return "CircleDot";
  const name = type.name.toLowerCase();
  if (name.includes("bug")) return "Bug";
  if (name.includes("story")) return "BookOpen";
  if (name.includes("epic")) return "Zap";
  if (name.includes("sub")) return "GitBranch";
  return "CircleDot"; // Task / default
}

export function groupIssuesByStatusCategory<
  T extends {
    fields: { status: { statusCategory: JiraStatusCategory } };
  },
>(issues: T[]): { category: string; categoryKey: string; issues: T[] }[] {
  const groups: Record<string, T[]> = {
    new: [],
    indeterminate: [],
    done: [],
  };

  for (const issue of issues) {
    const key = issue.fields.status.statusCategory.key;
    if (key in groups) {
      groups[key].push(issue);
    } else {
      groups.new.push(issue);
    }
  }

  const result: { category: string; categoryKey: string; issues: T[] }[] = [];
  if (groups.new.length > 0)
    result.push({ category: "To Do", categoryKey: "new", issues: groups.new });
  if (groups.indeterminate.length > 0)
    result.push({
      category: "In Progress",
      categoryKey: "indeterminate",
      issues: groups.indeterminate,
    });
  if (groups.done.length > 0)
    result.push({
      category: "Done",
      categoryKey: "done",
      issues: groups.done,
    });

  return result;
}
