import {
  type DirectoryFixtureConfig,
  type DirectoryScenario,
  handleDirectoryFixtureRequest,
} from "./directory-fixture.ts";

type FixtureEnvironment = Record<string, string | undefined>;

function fixtureFromEnvironment(env: FixtureEnvironment): {
  config: DirectoryFixtureConfig;
  scenario: DirectoryScenario;
} {
  const raw = env.AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON;
  const a2aSecret = env.A2A_SECRET;
  const scenario = env.AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO;
  if (!raw || !a2aSecret) {
    throw new Error("acceptance directory runtime is not configured");
  }
  if (scenario !== "stable" && scenario !== "withdraw-member") {
    throw new Error("acceptance directory scenario is not allowlisted");
  }
  const parsed = JSON.parse(raw) as Omit<DirectoryFixtureConfig, "a2aSecret">;
  return { config: { ...parsed, a2aSecret }, scenario };
}

export async function handleNetlifyDirectoryRequest(
  request: Request,
  env: FixtureEnvironment,
): Promise<Response> {
  try {
    const fixture = fixtureFromEnvironment(env);
    const result = await handleDirectoryFixtureRequest(
      { method: request.method, headers: request.headers },
      fixture.config,
      fixture.scenario,
    );
    return new Response(result.body ? JSON.stringify(result.body) : null, {
      status: result.status,
      headers: result.headers,
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export default async function acceptanceDirectory(request: Request) {
  return handleNetlifyDirectoryRequest(request, process.env);
}

export const config = { path: "/_agent-native/org/apps" };
