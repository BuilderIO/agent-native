---
title: "Adaptadores CLI"
description: "Dê ao agente acesso estruturado a qualquer ferramenta CLI (gh, ffmpeg, stripe) por meio de uma interface de adaptador padrão — uma das duas costuras de adaptador abordadas no guia Adaptadores."
---

# Adaptadores CLI

> **Onde isso se encaixa:** Os adaptadores CLI são uma das duas costuras do adaptador no
> . O guia canônico é [Adapters](/docs/sandbox-adapters), que
> cobre esta junção e a junção sandbox `run-code` — incluindo a compartilhada
> restrição de borda/sem servidor. Esta página é uma referência rápida para o lado CLI.

Um adaptador CLI envolve uma única ferramenta de linha de comando (`gh`, `ffmpeg`, `stripe`, `aws`) para que o agente possa descobri-lo, verificar se está instalado e executá-lo com um resultado stdout/stderr/código de saída consistente. Sem essa costura, todo script reinventa como invocar um CLI e analisar sua saída.

```an-diagram title="Adaptador CLI → registro → superfície de ação" summary="ShellCliAdapter encapsula um binário; CliRegistry coleta adaptadores para descoberta; defineAction expõe uma chamada na superfície de ação do agente + UI."
{
  "html": "<div class=\"diagram-cli\"><div class=\"diagram-node\" data-rough>gh · ffmpeg · stripe<br><small class=\"diagram-muted\">command-line tools</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ShellCliAdapter<br><small class=\"diagram-muted\">isAvailable · execute</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>CliRegistry<br><small class=\"diagram-muted\">describe() for discovery</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">defineAction</div></div>",
  "css": ".diagram-cli{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-cli .diagram-arrow{font-size:22px;line-height:1}.diagram-cli .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## A interface {#the-interface}

Cada adaptador CLI implementa `CliAdapter`:

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

Para a maioria dos CLIs você não precisa de uma classe personalizada — `ShellCliAdapter` envolve qualquer binário com padrões razoáveis:

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

Opções: `command` (obrigatório), `description` (obrigatório), `name` (o padrão é `command`), `env` (mesclado com `process.env`), `cwd` (o padrão é `process.cwd()`) e `timeoutMs` (padrão). `30000`).

Para autenticação personalizada, análise de saída ou pré/pós-processamento, implemente `CliAdapter` diretamente em vez de usar `ShellCliAdapter`.

## Registro {#registry}

`CliRegistry` coleta adaptadores para que o agente possa descobrir o que está disponível em tempo de execução:

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

## Usando de actions {#from-actions}

Envolva uma chamada CLI em `defineAction` para expô-la na superfície de ação — `defineAction` é necessário quando o código é executado dentro da superfície de ação do servidor; caso contrário, use um adaptador diretamente em um arquivo `scripts/`. Nunca chame `process.exit` em uma ação; em vez disso, gera um erro.

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

## Edge e sem servidor {#edge-serverless}

Os adaptadores CLI usam `node:child_process`, que não existe em tempos de execução de borda/trabalhador (Cloudflare Workers, Netlify Edge Functions). Execute tarefas e terminais do adaptador CLI em um ambiente Node.js padrão. Essa restrição é compartilhada com a costura sandbox — veja a discussão completa em [Adapters](/docs/sandbox-adapters#edge-serverless).

## O que vem a seguir

- [**Adapters**](/docs/sandbox-adapters) — o guia canônico para ambas as costuras do adaptador.
- [**Actions**](/docs/actions) — os adaptadores CLI da superfície de ação geralmente são incluídos.
