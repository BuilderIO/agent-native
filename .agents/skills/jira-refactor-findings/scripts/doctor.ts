// Preflight for Jira: credentials, project permissions, the Pod field option,
// and the branch-run link put on tickets.
import { main } from "../../fragility-common/lib/cli.ts";
import { type Check, runDoctor } from "../../fragility-common/lib/doctor.ts";
import { Jira, loadJiraConfig, runLink } from "./jira.ts";

main(async () => {
  const config = loadJiraConfig();
  const checks: Check[] = [];
  const check = (name: string, run: Check["run"], onFail?: Check["onFail"]) =>
    checks.push({ name, run, onFail });

  check("jira-auth", async () => {
    const jira = new Jira();
    const me = await jira.request<{
      emailAddress?: string;
      displayName?: string;
    }>("GET", "/rest/api/3/myself");
    return `authenticated as ${me?.displayName ?? "?"} <${me?.emailAddress ?? "?"}>`;
  });
  check("jira-permissions", async () => {
    const jira = new Jira();
    const wanted = [
      "CREATE_ISSUES",
      "CREATE_ATTACHMENTS",
      "ADD_COMMENTS",
      "EDIT_ISSUES",
      "LINK_ISSUES",
    ];
    const res = await jira.request<{
      permissions: Record<string, { havePermission: boolean }>;
    }>(
      "GET",
      `/rest/api/3/mypermissions?projectKey=${config.projectKey}&permissions=${wanted.join(",")}`,
    );
    const missing = wanted.filter((p) => !res?.permissions[p]?.havePermission);
    if (missing.length)
      throw new Error(`missing ${missing.join(", ")} on ${config.projectKey}`);
    return `${wanted.length} permissions on ${config.projectKey}`;
  });
  check("jira-pod-field", async () => {
    const jira = new Jira();
    const types = await jira.request<{
      issueTypes: { id: string; name: string }[];
    }>("GET", `/rest/api/3/issue/createmeta/${config.projectKey}/issuetypes`);
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
    const option = pod.allowedValues?.find((v) => v.id === config.podOptionId);
    if (!option) {
      throw new Error(
        `Pod option ${config.podOptionId} is not allowed on ${config.issueType}`,
      );
    }
    return `Pod ${config.podField} option ${option.id} is "${option.value}"`;
  });
  check(
    "run-link",
    () => {
      const link = runLink();
      if (!link.url)
        throw new Error(
          "no FRAGILITY_RUN_URL and FUSION_ENV_ORIGIN is not a Fusion preview URL",
        );
      return `${link.url} (from ${link.source})`;
    },
    "warn",
  );

  await runDoctor(checks);
});
