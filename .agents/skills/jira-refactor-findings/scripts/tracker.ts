// The Jira tracker for fragility-common's findings scripts: credentials,
// project permissions, and the Pod field option.
import type { Check } from "../../fragility-common/lib/doctor.ts";
import type { Tracker } from "../../fragility-common/lib/findings.ts";
import { Jira, loadJiraConfig, parseJiraKey } from "./jira.ts";

export function createTracker(): Tracker {
  return new Jira();
}

export function ticketUrl(key: string): string {
  return `${loadJiraConfig().baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

export const parseKey = parseJiraKey;

export function doctorChecks(): Check[] {
  const config = loadJiraConfig();
  return [
    {
      name: "jira-auth",
      run: async () => {
        const me = await new Jira().request<{
          emailAddress?: string;
          displayName?: string;
        }>("GET", "/rest/api/3/myself");
        return `authenticated as ${me?.displayName ?? "?"} <${me?.emailAddress ?? "?"}>`;
      },
    },
    {
      name: "jira-permissions",
      run: async () => {
        const wanted = [
          "CREATE_ISSUES",
          "CREATE_ATTACHMENTS",
          "ADD_COMMENTS",
          "EDIT_ISSUES",
          "LINK_ISSUES",
        ];
        const res = await new Jira().request<{
          permissions: Record<string, { havePermission: boolean }>;
        }>(
          "GET",
          `/rest/api/3/mypermissions?projectKey=${config.projectKey}&permissions=${wanted.join(",")}`,
        );
        const missing = wanted.filter(
          (p) => !res?.permissions[p]?.havePermission,
        );
        if (missing.length)
          throw new Error(
            `missing ${missing.join(", ")} on ${config.projectKey}`,
          );
        return `${wanted.length} permissions on ${config.projectKey}`;
      },
    },
    {
      name: "jira-pod-field",
      run: async () => {
        const jira = new Jira();
        const types = await jira.request<{
          issueTypes: { id: string; name: string }[];
        }>(
          "GET",
          `/rest/api/3/issue/createmeta/${config.projectKey}/issuetypes`,
        );
        const type = types?.issueTypes.find((t) => t.name === config.issueType);
        if (!type)
          throw new Error(
            `issue type ${config.issueType} not in ${config.projectKey}`,
          );
        const fields = await jira.request<{
          fields: {
            fieldId: string;
            allowedValues?: { id: string; value?: string }[];
          }[];
        }>(
          "GET",
          `/rest/api/3/issue/createmeta/${config.projectKey}/issuetypes/${type.id}?maxResults=200`,
        );
        const pod = fields?.fields.find((f) => f.fieldId === config.podField);
        if (!pod)
          throw new Error(
            `${config.podField} is not on the ${config.issueType} create screen`,
          );
        const option = pod.allowedValues?.find(
          (v) => v.id === config.podOptionId,
        );
        if (!option) {
          throw new Error(
            `Pod option ${config.podOptionId} is not allowed on ${config.issueType}`,
          );
        }
        return `Pod ${config.podField} option ${option.id} is "${option.value}"`;
      },
    },
  ];
}
