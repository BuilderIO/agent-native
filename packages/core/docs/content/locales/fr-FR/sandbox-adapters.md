---
title: "Adaptateurs"
description: "Les deux adaptateurs du framework : les adaptateurs sandbox échangent le backend qui exécute l'outil d'exécution de code de l'agent, et les adaptateurs CLI donnent à l'agent un accès structuré aux outils de ligne de commande."
search: "adaptateurs adaptateur sandbox adaptateur cli code d'exécution SandboxAdapter CliAdapter ShellCliAdapter exécuteur durable sandbox edge sans serveur child_process"
---

# Adaptateurs

> **À qui s'adresse-t-il :** les auteurs d'hôtes qui étendent le runtime. Les développeurs d'applications rarement
> j'en ai besoin – les valeurs par défaut fonctionnent immédiatement.

Agent-Native est doté de deux coutures d'adaptateur qui éliminent un problème derrière un étroit,
interface remplaçable :

- **Les adaptateurs Sandbox** échangent le backend qui exécute l'outil `run-code` de l'agent —
  un processus enfant local par défaut, ou un exécuteur Docker/distant/durable.
- **Les adaptateurs CLI** donnent à l'agent un accès structuré aux outils de ligne de commande
  (`gh`, `ffmpeg`, `stripe`) avec découverte, contrôles de disponibilité et
  forme de résultat cohérente.

Les deux partagent une contrainte d'exécution : ils s'appuient sur les liaisons système Node.js et le font
ne s'exécute pas sur les environnements d'exécution Edge/Worker – voir [Edge and serverless](#edge-serverless).

## Quel document de codage je veux ? {#which-doc}

| Vous voulez…                                                                             | Utiliser                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Échangez le backend qui exécute l'**outil `run-code`** de l'agent                        | **Adaptateurs Sandbox** (cette page)         |
| Encapsuler un outil CLI (`gh`, `ffmpeg`) pour que l'agent appelle                        | **Adaptateurs CLI** (cette page)             |
| Afficher un **espace de travail de codage de style Claude-Code/Codex** UI\*\*            | [Agent-Native Code UI](/docs/code-agents-ui) |
| Exécutez Claude Code / Codex / Pi **en tant qu'agent**, avec leur propre boucle + outils | [Harness Agents](/docs/harness-agents)       |

# Adaptateurs Sandbox

L'outil `run-code` exécute le JavaScript fourni par l'agent dans un environnement isolé. Les **adaptateurs Sandbox** prennent en compte le problème d'_exécution_ de cet outil afin que le backend puisse être échangé (un processus enfant local par défaut, ou un exécuteur Docker/distant/durable) sans toucher à la boucle d'agent, à `run-code.ts`, au pont localhost, au nettoyage d'environnement ou au formatage de sortie.

## Pourquoi une couture {#why}

Le backend par défaut génère un processus enfant de nœud local verrouillé. Cela est limité par le processus d'hébergement : sur la plate-forme hébergée, il partage le plafond d'exécution souple de la boucle d'agent (~ 40 s avant l'expiration du délai d'attente/la poursuite). Un adaptateur distant ou durable est le levier permettant de dépasser ce plafond : il exécute des tâches de données volumineuses jusqu'à leur achèvement indépendamment du cycle de vie de la demande.

En gardant le contrat étroit, un adaptateur distant hérite de la même posture de sécurité. Le processus parent conserve la propriété de tout ce qui porte secret : il construit le module sandbox, exécute le pont localhost (qui contient le contexte de la demande et applique les listes autorisées d'hôtes + les gardes SSRF), nettoie l'environnement et formate la sortie. Un adaptateur reçoit uniquement une source de module **non secrète** déjà préparée ainsi que les limites de ressources — il est uniquement responsable de son _exécution_ et de la capture de l'état stdout/stderr/exit.

```an-diagram title="Le parent garde les secrets ; l'adaptateur exécute uniquement du code" summary="run-code construit le module et exécute le pont de bouclage ; l'adaptateur reçoit un module non secret + limites et renvoie stdout/stderr/exit."
{
  "html": "<div class=\"diagram-sandbox\"><div class=\"diagram-box\" data-rough><strong>Processus parent</strong><small class=\"diagram-muted\">construit le module · pont loopback · nettoyage env · format de sortie</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">non-secret module + limits &rarr;</div><div class=\"diagram-pill ok\">&larr; stdout / stderr / exitCode</div><div class=\"diagram-pill\">&harr; bridge calls (127.0.0.1)</div></div><div class=\"diagram-panel center\" data-rough><strong>SandboxAdapter.run</strong><small class=\"diagram-muted\">processus enfant local · Docker · distant · durable</small></div></div>",
  "css": ".diagram-sandbox{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sandbox .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-sandbox .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## L'interface {#interface}

La couture réside dans le noyau de `packages/core/src/coding-tools/sandbox/` : `adapter.ts` (le contrat), `index.ts` (sélection : `getSandboxAdapter()` / `registerSandboxAdapter()`) et `local-child-process-adapter.ts` (la valeur par défaut). Il est câblé dans l'emballage par `run-code.ts` ; un hôte connecte un backend différent via l'assistant d'enregistrement `index.ts` (ou, pour un backend Docker, via le [blueprint](/docs/blueprint-installer) qui édite directement ces fichiers).

```an-file-tree title="Le point de jonction du sandbox dans core"
{
  "title": "packages/core/src/coding-tools/sandbox/",
  "entries": [
    { "path": "adapter.ts", "note": "Le contrat SandboxAdapter (SandboxRunRequest / SandboxRunResult)" },
    { "path": "index.ts", "note": "Sélection : getSandboxAdapter() / registerSandboxAdapter()" },
    { "path": "local-child-process-adapter.ts", "note": "Backend par défaut : processus enfant Node verrouillé" },
    { "path": "../run-code.ts", "note": "Relie ce point ; ne change jamais quand vous remplacez les backends" }
  ]
}
```

Chaque backend implémente `SandboxAdapter` :

```ts
interface SandboxAdapter {
  /** Stable id, surfaced for diagnostics and adapter selection. */
  readonly id: string;
  /** Execute one prepared sandbox module and capture its output. */
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
```

La requête et le résultat sont volontairement petits et opaques :

```ts
interface SandboxRunRequest {
  /**
   * The complete ESM module source to execute. Already wraps the user's code
   * and embeds the loopback bridge URL/token; the adapter does NOT parse or
   * rewrite it.
   */
  moduleSource: string;
  /**
   * Scrubbed environment — only safe POSIX vars (PATH/HOME/TMPDIR/…), never app
   * secrets. Adapters must not augment this with the parent's own environment.
   */
  env: Record<string, string>;
  /** Hard wall-clock timeout in milliseconds. The adapter must enforce it. */
  timeoutMs: number;
  /**
   * Loopback port of the parent's bridge server (reachable over 127.0.0.1). A
   * remote adapter that can't reach the parent's loopback must tunnel or proxy
   * this to support bridge-backed globals (`appAction`, `providerFetch`, …).
   */
  bridgePort: number;
}

interface SandboxRunResult {
  stdout: string;
  stderr: string;
  /** `0` on clean exit, non-zero on failure, `null` when killed by a signal. */
  exitCode: number | null;
  /** True when the run was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
}
```

## Par défaut : `LocalChildProcessAdapter` {#default}

Prêt à l'emploi, `getSandboxAdapter()` renvoie `LocalChildProcessAdapter` (`id: "local-child-process"`). Il préserve le comportement historique du `run-code` octet par octet :

- La source du module préparée est écrite dans un nouveau répertoire temporaire.
- L'enfant s'exécute avec l'environnement nettoyé (sans secrets), avec `TMPDIR`/`TEMP`/`TMP` pointé à l'intérieur du répertoire sandbox.
- Lorsque le modèle d'autorisation de nœud est disponible (`--permission` ou `--experimental-permission` sur le nœud 20), l'enfant se voit refuser l'accès au système de fichiers en dehors de son répertoire temporaire, ainsi qu'aux processus enfants, aux travailleurs et aux modules complémentaires natifs. Le réseau sortant n'est _pas_ bloqué par le modèle d'autorisation — mais le nettoyage d'environnement signifie que de telles requêtes ne comportent aucune information d'identification et que tous les appels authentifiés passent par le pont de bouclage du parent.
- Un timeout envoie `SIGTERM`, puis `SIGKILL` après un délai de grâce de 2 s.
- Les fichiers temporaires sont nettoyés au mieux après l'exécution.

> [!WARNING]
> L'adaptateur par défaut utilise `node:child_process`, qui n'existe pas sur les environnements d'exécution Edge/Worker. Exécutez `run-code` dans un environnement Node.js standard ou enregistrez un adaptateur distant – voir [Edge and serverless](#edge-serverless).

## Sélection d'un adaptateur {#selection}

Ordre de résolution : un adaptateur explicitement enregistré gagne ; sinon, la variable env sélectionne un élément intégré ; sinon, la valeur locale par défaut est utilisée :

```text
registerSandboxAdapter(adapter)  →  AGENT_NATIVE_SANDBOX  →  local default
```

### Variable d'environnement `AGENT_NATIVE_SANDBOX` {#env}

Sélectionne un adaptateur intégré par identifiant. Actuellement, seul le `local` (valeur par défaut) est câblé ; les valeurs inconnues reviennent au niveau local plutôt que d'échouer l'exécution.

```bash
AGENT_NATIVE_SANDBOX=local   # la valeur par défaut - explicite
```

### `registerSandboxAdapter()` {#register}

Un processus hôte remplace le backend pour tous les appels `run-code` ultérieurs via le `index.ts` de la couture — par exemple, pour exécuter chaque appel dans un conteneur distant :

```ts
import {
  registerSandboxAdapter,
  type SandboxAdapter,
} from "./coding-tools/sandbox/index.js";

class RemoteSandboxAdapter implements SandboxAdapter {
  readonly id = "remote";
  async run(request) {
    // Ship request.moduleSource to the durable runner, enforce request.timeoutMs,
    // proxy bridge calls back to request.bridgePort, and return stdout/stderr/exitCode.
  }
}

registerSandboxAdapter(new RemoteSandboxAdapter());
// Pass `null` to clear the override and fall back to env-var / default resolution.
```

## La couture pour un coureur durable {#durable}

Cette interface est délibérément le joint d'un futur bac à sable distant/durable. Un adaptateur distant ou durable (Docker, un exécuteur de type Vercel-Sandbox ou un travailleur en arrière-plan en file d'attente) :

1. Implémentez `SandboxAdapter.run` sur un environnement d'exécution hors processus.
2. Tunnelez le pont de bouclage (ou le pont proxy rappelle le parent).
3. Laissez les tâches de données volumineuses s'exécuter jusqu'à leur terme indépendamment du cycle de vie de la demande, en dépassant le plafond d'exécution de code hébergé d'environ 40 s qui limite l'adaptateur de processus enfant local.

Enregistrez-le sous une nouvelle valeur `AGENT_NATIVE_SANDBOX` (par exemple `remote`) et/ou via `registerSandboxAdapter()`. La boucle d'agent et `run-code.ts` ne changent jamais.

> [!TIP]
> Le plan `agent-native add sandbox docker` émet une recette complète et autonome pour implémenter un adaptateur Docker contre cette couture. Voir [Blueprint Installer](/docs/blueprint-installer).

# Adaptateurs CLI

L'autre joint d'adaptateur enveloppe un seul outil de ligne de commande (`gh`, `ffmpeg`, `stripe`, `aws`) afin que l'agent puisse le découvrir, vérifier s'il est installé et l'exécuter avec un résultat stdout/stderr/exit-code cohérent. Chaque adaptateur CLI implémente `CliAdapter` :

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

Pour la plupart des CLI, `ShellCliAdapter` encapsule n'importe quel binaire avec des valeurs par défaut raisonnables, et `CliRegistry` collecte des adaptateurs pour la découverte du runtime :

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({
    command: "gh",
    description: "GitHub CLI — manage repos, PRs, issues, and releases",
  }),
);

await cliRegistry.describe(); // [{ name, description, available }] for discovery
const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

Enveloppez un appel CLI dans `defineAction` pour l'exposer sur la surface d'action. Consultez la référence rapide [CLI Adapters](/docs/cli-adapters) pour les options `ShellCliAdapter`, les adaptateurs personnalisés et le modèle d'encapsulage d'action.

## Edge et sans serveur {#edge-serverless}

> [!WARNING]
> Les deux coutures d'adaptateur reposent sur les fixations du système Node.js. Les adaptateurs sandbox `LocalChildProcessAdapter` et CLI (`ShellCliAdapter` et adaptateurs personnalisés) utilisent `node:child_process` (`execFile` / `spawn`), qui **n'existe pas** sur les environnements d'exécution Edge/Worker tels que Cloudflare Workers ou Netlify Edge Functions. Si vous déployez des routes de serveur vers ces préréglages Edge, l'exécution de ces adaptateurs génère une exception d'exécution. Exécutez les points de terminaison et les tâches de l'adaptateur dans un environnement Node.js standard (conteneurs de serveur traditionnels ou fonctions de nœud sans serveur) ou, pour la couture sandbox, enregistrez un adaptateur distant qui expédie le travail hors processus.

## Quelle est la prochaine étape

- [**CLI Adapters**](/docs/cli-adapters) — la référence rapide pour la couture CLI
- [**Blueprint Installer**](/docs/blueprint-installer) — `agent-native add sandbox docker` imprime une recette d'adaptateur Docker
- [**Agent Teams**](/docs/agent-teams) — déléguer des tâches lourdes à des sous-agents
- [**Security**](/docs/security) – la posture de nettoyage d'environnement et de liste d'autorisation de pont
