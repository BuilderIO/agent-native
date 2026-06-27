---
title: "CLI-Adapter"
description: "Gewähren Sie dem Agenten strukturierten Zugriff auf jedes CLI-Tool (gh, ffmpeg, Stripe) über eine Standardadapterschnittstelle – eine der beiden im Adapterhandbuch behandelten Adapterschnittstellen."
---

# CLI-Adapter

> **Wo das passt:** CLI-Adapter sind eine von zwei Adapternähten im
> -Framework. Der kanonische Leitfaden ist [Adapters](/docs/sandbox-adapters), der
> deckt sowohl diese Naht als auch die `run-code`-Sandbox-Naht ab – einschließlich der gemeinsamen
> Edge-/serverlose Einschränkung. Diese Seite ist die Kurzreferenz für die CLI-Seite.

Ein CLI-Adapter umschließt ein einzelnes Befehlszeilentool (`gh`, `ffmpeg`, `stripe`, `aws`), sodass der Agent es erkennen, prüfen kann, ob es installiert ist, und es mit einem konsistenten stdout/stderr/exit-code-Ergebnis ausführen kann. Ohne diese Naht erfindet jedes Skript die Art und Weise neu, wie ein CLI aufgerufen und seine Ausgabe analysiert wird.

```an-diagram title="CLI Adapter → Registrierung → Aktionsoberfläche" summary="ShellCliAdapter umschließt eine Binärdatei; CliRegistry sammelt Adapter zur Erkennung; defineAction macht einen Aufruf auf der Aktionsoberfläche des Agenten und der Benutzeroberfläche verfügbar."
{
  "html": "<div class=\"diagram-cli\"><div class=\"diagram-node\" data-rough>gh · ffmpeg · stripe<br><small class=\"diagram-muted\">command-line tools</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ShellCliAdapter<br><small class=\"diagram-muted\">isAvailable · execute</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>CliRegistry<br><small class=\"diagram-muted\">describe() for discovery</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">defineAction</div></div>",
  "css": ".diagram-cli{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-cli .diagram-arrow{font-size:22px;line-height:1}.diagram-cli .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Die Schnittstelle {#the-interface}

Jeder CLI-Adapter implementiert `CliAdapter`:

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string; // "gh", "stripe", "ffmpeg"
  description: string; // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

## ShellCliAdapter {#shell-adapter}

Für die meisten CLIs benötigen Sie keine benutzerdefinierte Klasse – `ShellCliAdapter` umschließt jede Binärdatei mit sinnvollen Standardwerten:

```ts
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
});

const ffmpeg = new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
  timeoutMs: 120_000, // 2 min for long encodes
  env: { STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
});
```

Optionen: `command` (erforderlich), `description` (erforderlich), `name` (standardmäßig `command`), `env` (zusammengeführt mit `process.env`), `cwd` (standardmäßig `process.cwd()`) und `timeoutMs` (standardmäßig `30000`).

Für benutzerdefinierte Authentifizierung, Ausgabeanalyse oder Vor-/Nachbearbeitung implementieren Sie `CliAdapter` direkt, anstatt `ShellCliAdapter` zu verwenden.

## Registrierung {#registry}

`CliRegistry` sammelt Adapter, damit der Agent erkennen kann, was zur Laufzeit verfügbar ist:

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({ command: "gh", description: "GitHub CLI" }),
);

cliRegistry.list(); // all registered
await cliRegistry.listAvailable(); // only installed
await cliRegistry.describe(); // [{ name, description, available }] for discovery

const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

## Verwendung von actions {#from-actions}

Einen CLI-Aufruf in `defineAction` einschließen, um ihn auf der Aktionsoberfläche verfügbar zu machen – `defineAction` ist erforderlich, wenn der Code innerhalb der Server-Aktionsoberfläche ausgeführt wird; Andernfalls verwenden Sie einen Adapter direkt in einer `scripts/`-Datei. Rufen Sie niemals `process.exit` in einer Aktion auf; Stattdessen wird ein Fehler ausgegeben.

```ts
// actions/list-prs.ts
import { defineAction } from "@agent-native/core/action";
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";
import { z } from "zod";

const gh = new ShellCliAdapter({ command: "gh", description: "GitHub CLI" });

export default defineAction({
  description: "List open pull requests via the GitHub CLI.",
  schema: z.object({}),
  async run() {
    if (!(await gh.isAvailable())) {
      throw new Error("GitHub CLI not installed. Run: brew install gh");
    }
    const result = await gh.execute([
      "pr",
      "list",
      "--json",
      "title,url,state",
      "--limit",
      "10",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "gh pr list failed");
    }
    return JSON.parse(result.stdout);
  },
});
```

## Edge und serverlos {#edge-serverless}

CLI-Adapter verwenden `node:child_process`, das auf Edge-/Worker-Laufzeiten (Cloudflare Workers, Netlify Edge Functions) nicht vorhanden ist. Führen Sie CLI-Adapterendpunkte und -Aufgaben in einer Standard-Node.js-Umgebung aus. Diese Einschränkung gilt für den Sandbox-Seam – siehe die vollständige Diskussion in [Adapters](/docs/sandbox-adapters#edge-serverless).

## Was kommt als nächstes?

- [**Adapters**](/docs/sandbox-adapters) – die kanonische Anleitung für beide Adapternähte.
- [**Actions**](/docs/actions) – die Aktionsoberflächen-CLI-Adapter sind normalerweise eingepackt.
