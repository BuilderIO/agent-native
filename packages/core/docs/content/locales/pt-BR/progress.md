---
title: "Progresso"
description: "Sinal de progresso em tempo real para tarefas de agente de longa duração — iniciar, atualizar, concluir"
---

# Progresso

Tarefas longas de agente não devem se esconder atrás de um botão giratório. `progress_runs` oferece ao agente uma maneira de anunciar _"Estou trabalhando nisso, terminei 45%, aqui está a etapa atual"_ - que o UI renderiza como uma bandeja de execuções flutuante com uma barra de porcentagem.

```ts
import {
  startRun,
  updateRunProgress,
  completeRun,
} from "@agent-native/core/progress";

const run = await startRun({
  owner: "steve@builder.io",
  title: "Triage 128 unread emails",
  step: "Fetching inbox",
});

for (let i = 1; i <= total; i++) {
  await updateRunProgress(run.id, run.owner, {
    percent: Math.round((i / total) * 100),
    step: `Classifying ${i}/${total}`,
  });
}

await completeRun(run.id, run.owner, "succeeded");
```

Preocupação separada de [notifications](/docs/notifications): as notificações são disparadas uma vez (_"X aconteceu"_), o progresso é um estado contínuo (_"X está 45% concluído"_). Os dois compõem - `completeRun` seguido de `notify(..., severity: "info")` informa ao usuário quando o trabalho termina, mesmo que ele não esteja observando a bandeja.

## O ciclo de vida {#lifecycle}

| Status      | Transição                         |
| ----------- | --------------------------------- |
| `running`   | Inicial — definido por `startRun` |
| `succeeded` | Terminal de caminho feliz         |
| `failed`    | Erro no terminal                  |
| `cancelled` | Usuário interrompido              |

```an-diagram title="Executar ciclo de vida" summary="startRun abre uma linha em execução; updateRunProgress corrige; completeRun move-o para um status de terminal e marca completed_at."
{
  "html": "<div class=\"diagram-run\"><div class=\"diagram-box\" data-rough>startRun()</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel running\" data-rough><span class=\"diagram-pill accent\">running</span><small class=\"diagram-muted\">updateRunProgress() &#8635; percent + step</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col terminal\"><span class=\"diagram-pill ok\">succeeded</span><span class=\"diagram-pill warn\">failed</span><span class=\"diagram-pill\">cancelled</span><small class=\"diagram-muted\">completeRun() &rarr; sets completed_at</small></div></div>",
  "css": ".diagram-run{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-run .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:12px 16px}.diagram-run .terminal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.diagram-run .diagram-arrow{font-size:22px;line-height:1}"
}
```

Status do terminal definidos como `completed_at`. A bandeja UI mostra apenas linhas `running`; as linhas concluídas permanecem no banco de dados para consultas `action=list`.

## API {#api}

### `startRun(input)` {#start}

Crie uma corrida. Retorna o `AgentRun` completo com um ID gerado.

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

Emite `run.progress.started` no barramento de eventos.

### `updateRunProgress(id, owner, input)` {#update}

Corrija qualquer campo de uma execução em execução. Qualquer campo omitido permanece inalterado.

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

Emite `run.progress.updated` no barramento de eventos. Retorna o `AgentRun` atualizado ou `null` se a execução não existir ou não pertencer ao chamador.

### `completeRun(id, owner, status, extras?)` {#complete}

Transição para um status de terminal. `succeeded` define implicitamente `percent=100`.

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

Também emite `run.progress.updated` com o status do terminal.

### Listagem {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

Montado em `/_agent-native/runs/*` pelo plugin core-routes. **Somente leitura em HTTP** — as gravações passam pelas ferramentas do agente, pois o agente é o gravador canônico. Todas as rotas têm escopo do proprietário.

| Método   | Caminho                           |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

```an-api title="Listar execuções ativas" method="GET" path="/_agent-native/runs"
{
  "method": "GET",
  "path": "/_agent-native/runs",
  "summary": "List the caller's runs. The RunsTray polls this with active=true.",
  "description": "Read-only and owner-scoped — every row has an `owner` column and every query filters on it, so callers only ever see their own runs. Writes (start/update/complete) go through the agent's `manage-progress` tool, not HTTP.",
  "auth": "Session cookie (owner-scoped)",
  "params": [
    { "name": "active", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only `running` rows." }
  ],
  "responses": [
    { "status": "200", "description": "Array of AgentRun rows owned by the caller." }
  ]
}
```

## Componente UI {#ui}

```tsx
import { RunsTray } from "@agent-native/core/client/progress";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <RunsTray />
    </header>
  );
}
```

Widget de cabeçalho embutido – monte-o próximo ao sino de notificações. Mostra um ícone giratório + emblema de contagem quando as corridas estão ativas; clicar abre um menu suspenso com uma barra percentual ativa por execução. Oculta totalmente o gatilho quando não há execução ativa. Pesquisa `/_agent-native/runs?active=true` a cada `pollMs` (padrão 3 s). Usa tokens semânticos shadcn e se adapta a temas claros e escuros.

## Ferramenta de agente {#agent-tool}

Uma única ferramenta `manage-progress` é registrada em cada modelo. O parâmetro `action` seleciona a operação:

| Ação       | Propósito                                                        |
| ---------- | ---------------------------------------------------------------- |
| `start`    | Chame no início de uma tarefa longa. Retorna um runId.           |
| `update`   | Chame periodicamente durante a tarefa com `percent` e/ou `step`. |
| `complete` | Terminal — um dos `succeeded`, `failed`, `cancelled`.            |
| `list`     | Inspecione execuções recentes (filtre por `active=true`).        |

### Quando iniciar uma corrida {#when-to-start}

- Use para qualquer coisa > ~5 segundos. Um botão giratório sem contexto parece congelado.
- Atualização em pontos de verificação naturais, não em todas as iterações. Cada 5–10% é suficiente.
- **Sempre** chame `manage-progress` com `action=complete`, inclusive em caminhos de erro. Uma linha `running` órfã é pior do que nenhuma linha.
- Emparelhe com `notify` ao concluir para que o usuário veja o resultado quando não estiver observando ativamente a bandeja.

## Barramento de eventos {#event-bus}

Dois eventos emitidos no [event bus](/docs/automations#event-bus):

| Evento                 | Carga útil                         |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

[Automations](/docs/automations) pode assinar estes — por exemplo, _"se uma corrida demorar mais de 5 minutos, avise-me"_:

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is failed"
mode: agentic
---
Notificar me that run {{runId}} has failed.
```

## Como funciona {#internals}

- **Escopo do proprietário** — cada linha tem uma coluna `owner`; cada consulta é filtrada nela. Os usuários veem apenas suas próprias corridas.
- **Integração de pesquisa** — cada mutação chama `recordChange()` para que os modelos que usam [`useDbSync`](/docs/client) sejam invalidados automaticamente sem qualquer conexão extra.
- **Nome da tabela** — a estrutura também possui uma tabela `agent_runs` para rastreamento interno do ciclo de vida do turno de bate-papo entre agentes. A primitiva de progresso usa `progress_runs` para manter os dois interesses separados.
- **Ajuste percentual** — os valores são fixados em `[0, 100]` e arredondados para um número inteiro na gravação.

## O que vem a seguir

- [**Notifications**](/docs/notifications) — emparelhe com `manage-progress` (`action=complete`) para informar ao usuário quando o trabalho terminar
- [**Automations**](/docs/automations) — execuções lentas do watchdog via `run.progress.updated`
- [**Client**](/docs/client) — `useDbSync` para invalidação de cache em tempo real
