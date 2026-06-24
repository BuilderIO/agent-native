---
title: "Adaptateurs CLI"
description: "Donnez à l'agent un accès structuré à n'importe quel outil CLI (gh, ffmpeg, stripe) via une interface d'adaptateur standard – l'une des deux coutures d'adaptateur couvertes dans le guide des adaptateurs."
---

# Adaptateurs CLI

> **Où cela convient :** Les adaptateurs CLI sont l'un des deux joints d'adaptateur du
> . Le guide canonique est [Adapters](/docs/sandbox-adapters), qui
> couvre à la fois cette couture et la couture du bac à sable `run-code`, y compris la couture partagée
> contrainte Edge/sans serveur. Cette page est la référence rapide pour le côté CLI.

Un adaptateur CLI encapsule un seul outil de ligne de commande (`gh`, `ffmpeg`, `stripe`, `aws`) afin que l'agent puisse le découvrir, vérifier s'il est installé et l'exécuter avec un résultat stdout/stderr/exit-code cohérent. Sans cette couture, chaque script réinvente la façon d'invoquer un CLI et d'analyser sa sortie.

```an-diagram title="Adaptateur CLI → registre → surface d'action" summary="ShellCliAdapter encapsule un binaire ; CliRegistry collecte les adaptateurs pour la découverte ; defineAction expose un appel sur la surface d'action agent + interface utilisateur."
{
  "html": "<div class=\"diagram-cli\"><div class=\"diagram-node\" data-rough>gh · ffmpeg · stripe<br><small class=\"diagram-muted\">command-line tools</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ShellCliAdapter<br><small class=\"diagram-muted\">isAvailable · execute</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>CliRegistry<br><small class=\"diagram-muted\">describe() for discovery</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">defineAction</div></div>",
  "css": ".diagram-cli{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-cli .diagram-arrow{font-size:22px;line-height:1}.diagram-cli .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## L'interface {#the-interface}

Chaque adaptateur CLI implémente `CliAdapter` :

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

## ShellCliAdaptateur {#shell-adapter}

Pour la plupart des CLI, vous n'avez pas besoin d'une classe personnalisée : `ShellCliAdapter` encapsule n'importe quel binaire avec des valeurs par défaut raisonnables :

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

Options : `command` (obligatoire), `description` (obligatoire), `name` (par défaut : `command`), `env` (fusionné avec `process.env`), `cwd` (par défaut : `process.cwd()`) et `timeoutMs` (par défaut : `30000`).

Pour une authentification personnalisée, une analyse de sortie ou un pré/post-traitement, implémentez `CliAdapter` directement au lieu d'utiliser `ShellCliAdapter`.

## Registre {#registry}

`CliRegistry` collecte les adaptateurs afin que l'agent puisse découvrir ce qui est disponible au moment de l'exécution :

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

## Utilisation depuis actions {#from-actions}

Encapsulez un appel CLI dans `defineAction` pour l'exposer sur la surface d'action : `defineAction` est requis lorsque le code s'exécute à l'intérieur de la surface d'action du serveur ; sinon, utilisez un adaptateur directement dans un fichier `scripts/`. N'appelez jamais `process.exit` dans une action ; renvoie une erreur à la place.

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

## Edge et sans serveur {#edge-serverless}

Les adaptateurs CLI utilisent `node:child_process`, qui n'existe pas sur les environnements d'exécution Edge/Worker (Cloudflare Workers, Netlify Edge Functions). Exécutez les points de terminaison et les tâches de l'adaptateur CLI dans un environnement Node.js standard. Cette contrainte est partagée avec la couture sandbox — voir la discussion complète dans [Adapters](/docs/sandbox-adapters#edge-serverless).

## Quelle est la prochaine étape

- [**Adapters**](/docs/sandbox-adapters) — le guide canonique des deux coutures d'adaptateur.
- [**Actions**](/docs/actions) — les adaptateurs de surface d'action CLI sont généralement enveloppés.
