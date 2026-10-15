// The dev server banner (`_devServerStartupBanner` in core's vite/client.ts).
// When the requested port is taken between our probe and the bind, the server
// hops to the next free port and this line carries the port it actually got.
const LISTENING = /^\[agent-native\] .+ listening on (https?:\/\/\S+)/gm;

export function devServerListeningUrl(log: string): string | undefined {
  let url: string | undefined;
  for (const match of log.matchAll(LISTENING)) url = match[1];
  return url?.replace(/\/$/, "");
}
