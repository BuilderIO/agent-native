// Preflight for an unattended run. Exit 0 ready, 1 a check failed, 2 a check
// could not run. Every check reports; nothing is skipped silently.
import { Jira, runLink } from "./jira.ts";
import { loadConfig, main, run } from "./lib.ts";

type Status = "ok" | "warn" | "fail" | "error";

main(async () => {
  const config = loadConfig();
  const checks: { name: string; status: Status; detail: string }[] = [];
  const check = async (
    name: string,
    fn: () => Promise<string> | string,
    onFail: Status = "fail",
  ) => {
    try {
      checks.push({ name, status: "ok", detail: await fn() });
    } catch (error) {
      checks.push({
        name,
        status: onFail,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await check("git", () => {
    const filter = run("git", [
      "config",
      "--default",
      "",
      "--get",
      "remote.origin.partialclonefilter",
    ]).trim();
    run("git", ["rev-parse", "--verify", `origin/${config.baseBranch}`]);
    return filter
      ? `origin/${config.baseBranch} present; partial clone (${filter}), so scripts avoid blob-reading git commands`
      : `origin/${config.baseBranch} present`;
  });
  await check("github", () => {
    const out = run(
      "gh",
      ["api", "rate_limit", "--jq", ".resources.graphql.remaining"],
      { timeoutMs: 30_000 },
    );
    return `gh authenticated, ${out.trim()} GraphQL points left`;
  });
  await check("jira-auth", async () => {
    const jira = new Jira(config);
    const me = await jira.request<{
      emailAddress?: string;
      displayName?: string;
    }>("GET", "/rest/api/3/myself");
    return `authenticated as ${me?.displayName ?? "?"} <${me?.emailAddress ?? "?"}>`;
  });
  await check("jira-permissions", async () => {
    const jira = new Jira(config);
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
      `/rest/api/3/mypermissions?projectKey=${config.jira.projectKey}&permissions=${wanted.join(",")}`,
    );
    const missing = wanted.filter((p) => !res?.permissions[p]?.havePermission);
    if (missing.length)
      throw new Error(
        `missing ${missing.join(", ")} on ${config.jira.projectKey}`,
      );
    return `${wanted.length} permissions on ${config.jira.projectKey}`;
  });
  await check("jira-pod-field", async () => {
    const jira = new Jira(config);
    const types = await jira.request<{
      issueTypes: { id: string; name: string }[];
    }>(
      "GET",
      `/rest/api/3/issue/createmeta/${config.jira.projectKey}/issuetypes`,
    );
    const type = types?.issueTypes.find(
      (t) => t.name === config.jira.issueType,
    );
    if (!type)
      throw new Error(
        `issue type ${config.jira.issueType} not in ${config.jira.projectKey}`,
      );
    const fields = await jira.request<{
      fields: { fieldId: string; allowedValues?: { value?: string }[] }[];
    }>(
      "GET",
      `/rest/api/3/issue/createmeta/${config.jira.projectKey}/issuetypes/${type.id}?maxResults=200`,
    );
    const pod = fields?.fields.find((f) => f.fieldId === config.jira.podField);
    if (!pod)
      throw new Error(
        `${config.jira.podField} is not on the ${config.jira.issueType} create screen`,
      );
    if (!pod.allowedValues?.some((v) => v.value === config.jira.podValue)) {
      throw new Error(`"${config.jira.podValue}" is not an allowed Pod value`);
    }
    return `Pod ${config.jira.podField} accepts "${config.jira.podValue}"`;
  });
  await check(
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

  for (const c of checks)
    console.log(`${c.status.toUpperCase().padEnd(5)} ${c.name}: ${c.detail}`);
  const credentialError = checks.some(
    (c) => c.status === "fail" && /credentials|not set/.test(c.detail),
  );
  if (credentialError || checks.some((c) => c.status === "error"))
    process.exit(2);
  if (checks.some((c) => c.status === "fail")) process.exit(1);
});
