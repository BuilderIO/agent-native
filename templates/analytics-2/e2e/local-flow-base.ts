export function requestedLocalFlowBase() {
  // guard:allow-env-credential — local test origin, validated as loopback below
  return process.env.FLOW_BASE_URL;
}

export function localFlowBase(
  value = requestedLocalFlowBase() ?? "http://127.0.0.1:8105",
  assignedPort = process.env.AGENT_NATIVE_ANALYTICS_LOCAL_FIXTURE_PORT,
) {
  if (
    assignedPort !== undefined &&
    (!/^[1-9][0-9]{3,4}$/.test(assignedPort) ||
      Number(assignedPort) < 1024 ||
      Number(assignedPort) > 65535)
  )
    throw new Error("Local fixture port is invalid");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "FLOW_BASE_URL must be a local HTTP origin with an explicit port",
    );
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["8105", "8124", assignedPort].includes(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "FLOW_BASE_URL must be a local HTTP origin with an explicit port",
    );
  return url.origin;
}
