import type { Plugin } from "vite";

export function agentKitViteDiagnostics(): Plugin {
  return {
    name: "agentkit-acceptance-vite-diagnostics",
    apply: "serve",
    configureServer(server) {
      let remaining = 30;
      const changes: string[] = [];
      server.watcher.on("all", (event, file) => {
        changes.push(`${event}: ${file}`);
        if (changes.length > 8) changes.shift();
      });
      const send = server.ws.send.bind(server.ws);
      server.ws.send = ((...args: Parameters<typeof send>) => {
        const payload = args[0] as unknown;
        if (
          payload &&
          typeof payload === "object" &&
          "type" in payload &&
          payload.type === "full-reload" &&
          remaining-- > 0
        ) {
          console.warn(
            "[agentkit-acceptance] Vite full reload",
            JSON.stringify(payload),
            JSON.stringify(changes),
            new Error().stack?.split("\n").slice(1).join("\n"),
          );
        }
        return send(...args);
      }) as typeof server.ws.send;
    },
  };
}
