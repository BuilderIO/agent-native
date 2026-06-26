---
title: "Equipes de agentes"
description: "Os agentes delegados principais trabalham para subagentes que executam seus próprios threads e aparecem como chips de visualização ao vivo in-line no chat."
---

# Equipes de agentes

O chat do agente é um **orquestrador**, não um monólito. Quando o agente principal realiza uma tarefa que pertence melhor a um especialista — “escrever este e-mail com minha voz”, “executar uma análise do BigQuery”, “revisar este PR” — ele gera um subagente em seu próprio thread, ferramentas e contexto. O subagente aparece como um **chip** de visualização ao vivo embutido no chat principal; clique nele para abrir a conversa completa como uma guia.

Isso mantém o thread principal focado, permite que os subagentes sejam executados em paralelo e fornece uma trilha de auditoria limpa para qualquer trabalho delegado.

O Agent Teams é executado no run-manager principal: os eventos são transmitidos e persistidos, os abortos são propagados por meio do SQL e as tarefas sobrevivem às inicializações a frio sem servidor.

## O modelo mental {#mental-model}

- **Chat principal** — o orquestrador. Lê o seu pedido, delegados. Raramente realiza trabalho pesado.
- **Subagentes** — executam com seu próprio thread, seu próprio prompt de sistema, seu próprio conjunto de ferramentas. Cada um mapeia para um perfil de "agente personalizado" no [workspace](/docs/workspace).
- **Chips** — o cartão de visualização avançado que aparece embutido no chat principal, mostrando a etapa atual do subagente, a saída do streaming e o resumo final. Recolhido por padrão; expande para a conversa completa ao clicar.
- **Mensagens bidirecionais** — o agente principal pode enviar acompanhamentos para um subagente em execução; um subagente pode responder quando chegar a um ponto ambíguo.

O estado do subagente é persistido na tabela `application_state` SQL (em `agent-task:<taskId>`), para que as tarefas sobrevivam a inicializações a frio sem servidor e funcionem em vários processos.

```an-diagram title="Orquestrador e especialistas" summary="O chat principal delega para subagentes que executam seus próprios threads e reportam como chips embutidos."
{
  "html": "<div class=\"at-orc\"><div class=\"diagram-card main\"><span class=\"diagram-pill accent\">Chat principal</span><small class=\"diagram-muted\">orchestrator &mdash; reads your request, delegates</small></div><div class=\"at-fan\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"at-subs\"><div class=\"diagram-box\">Revisão de código<br><small class=\"diagram-muted\">own thread &amp; prompt</small></div><div class=\"diagram-box\">Análise BigQuery<br><small class=\"diagram-muted\">own tools</small></div><div class=\"diagram-box\">E-mail por voz<br><small class=\"diagram-muted\">own context</small></div></div></div><div class=\"diagram-pill\">each appears inline as a live chip &#8635;</div></div>",
  "css": ".at-orc{display:flex;flex-direction:column;align-items:center;gap:12px}.at-orc .diagram-card{padding:14px 18px;display:flex;flex-direction:column;gap:4px;align-items:center}.at-orc .at-fan{display:flex;flex-direction:column;align-items:center;gap:8px}.at-orc .diagram-arrow{font-size:22px}.at-orc .at-subs{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.at-orc .diagram-box{text-align:center}"
}
```

## Quando gerar um subagente {#when-to-spawn}

Aparece quando a tarefa:

- É necessário um **prompt de sistema** diferente (uma voz ou tom especializado, por exemplo, "revisão de código").
- Tem uma cadeia de ferramentas de **longa execução** que poluiria o contexto principal.
- Pode ser executado **em paralelo** com outro trabalho que o agente principal esteja realizando.
- Pertence a uma **equipe diferente** que já tem um perfil de agente personalizado.

Não crie trabalhos triviais de uma única ação — chame a ação diretamente.

## Invocando um subagente {#invoking}

Três maneiras de iniciar um subagente, da menos à mais explícita:

### 1. `@mention` um agente personalizado {#mention}

O usuário digita `@agent-name` no compositor do chat. Uma lista suspensa de subagentes do espaço de trabalho é exibida. Selecionar um insere um chip; ao enviar, o agente principal delega a mensagem a esse subagente.

Os agentes personalizados residem no espaço de trabalho em `agents/<slug>.md` — um arquivo Markdown com frontmatter YAML. Consulte [Custom Agents](/docs/workspace#custom-agents) para obter o formato.

### 2. O agente principal delega automaticamente {#auto-delegate}

A estrutura fornece ao agente principal uma ferramenta `agent-teams`. Quando o modelo decide que uma tarefa se ajusta a um perfil de subagente registrado, ele chama a ferramenta com `action: "spawn"` e um parâmetro `agent` opcional nomeando um perfil de `agents/*.md`. Um chip aparece; o subagente é executado. O agente principal espera (ou segue em paralelo) e incorpora o resultado quando o subagente termina.

O conjunto completo de ações `agent-teams` é:

| Ação          | Propósito                                         |
| ------------- | ------------------------------------------------- |
| `spawn`       | Iniciar uma nova tarefa de subagente              |
| `status`      | Verificar o progresso de um subagente em execução |
| `read-result` | Obtenha a saída final de um subagente             |
| `send`        | Enviar mensagem para um subagente em execução     |
| `list`        | Ver todas as tarefas do usuário atual             |

### 3. Geração programática {#programmatic-spawn}

Para integrações em nível de estrutura, use `spawnTask()` de `@agent-native/core/server`:

```ts
import { spawnTask } from "@agent-native/core/server";

const task = await spawnTask({
  description: "Draft an outreach email to this lead",
  instructions: "Match the user's voice from memory/MEMORY.md.",
  ownerEmail: user.email,
  systemPrompt: mailAgentSystemPrompt,
  actions: mailActions,
  // Pass either apiKey or engine — engine takes precedence.
  apiKey: process.env.ANTHROPIC_API_KEY, // optional if engine is provided
  parentSend: emit, // streaming sender for the parent chat response
});
```

A maior parte do código do aplicativo não chama isso diretamente — a estrutura faz isso nos bastidores para `@mentions` e para a ferramenta `agent-teams`. Alcance `spawnTask()` somente quando estiver conectando um novo ponto de entrada (por exemplo, um botão que inicia um trabalho em segundo plano executado como um subagente).

## Ciclo de vida da tarefa {#lifecycle}

```an-diagram title="O que spawnTask() faz" summary="Cada spawn cria um thread, persiste o estado para SQL e transmite eventos de chip até a conclusão."
{
  "html": "<div class=\"at-life\"><div class=\"diagram-box\"><code>spawnTask()</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">create thread</span><small class=\"diagram-muted\">new row in <code>chat_threads</code>, description as first message</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">persist state</span><small class=\"diagram-muted\"><code>agent-task:&lt;id&gt;</code> &rarr; <code>application_state</code>, status=running</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">stream</span><small class=\"diagram-muted\"><code>agent_task_started</code> &rarr; chip appears; <code>agent_task_step</code> &rarr; chip updates live</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">complete</span><small class=\"diagram-muted\">status=completed, write summary + preview, emit <code>agent_task_done</code></small></div></div>",
  "css": ".at-life{display:flex;flex-direction:column;align-items:stretch;gap:6px;max-width:560px}.at-life .diagram-card{display:flex;flex-direction:column;gap:3px;padding:10px 14px}.at-life .diagram-box{align-self:flex-start}.at-life .diagram-arrow{font-size:18px;align-self:center}"
}
```

A qualquer momento o agente pai pode retomar o subagente com acompanhamento via `sendToTask(taskId, message)`. Se o subagente cometer erros, `markTaskErrored(taskId, reason)` registra a falha e a apresenta ao usuário.

As mensagens bidirecionais são duráveis. O acompanhamento dos pais aos subagentes em execução é
entregue durante o ciclo de vida da tarefa; se o subagente não puder consumi-los em
na etapa atual, eles devem permanecer na fila e ser aplicados em um local seguro
ponto de continuação. Os subagentes também podem responder quando precisarem de esclarecimentos
em vez de bloquear de forma invisível.

## Leitura do estado da tarefa {#reading-state}

Do código do servidor ou outro actions:

```ts
import { getTask, listTasks } from "@agent-native/core/server";

const task = await getTask(taskId); // single task
const tasks = await listTasks(); // all tasks for the user (sorted newest first)
```

Campos-chave `AgentTask`:

```ts
interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string; // short one-liner for the chip
  summary: string; // full summary once completed
  currentStep: string; // latest step label (updated while running)
  createdAt: number;
  // Additional fields: parentThreadId, name, updatedAt, startedAt,
  // completedAt, runId, error
}
```

## Perfis de agentes personalizados {#profiles}

Mapeamento de subagentes para perfis de agentes personalizados — arquivos Markdown em `agents/<slug>.md` no espaço de trabalho que aparecem no menu suspenso `@mention` e servem como alvos de delegação. [Workspace — Custom Agents](/docs/workspace#custom-agents) possui o formato completo (frontmatter, `tools`, `delegate-default`, substituições de modelo).

## Proteção de profundidade de delegação {#depth-guard}

Subagentes podem gerar subagentes, o que é um risco descontrolado/de custo: uma cadeia ilimitada de delegações pode se espalhar indefinidamente. A estrutura impõe um **limite rígido na profundidade da delegação**, no lado do servidor, independente de qualquer proteção no nível da ferramenta.

O bate-papo de nível superior é profundo `0`. Um subagente gerado é a profundidade `1`; esse subagente pode aparecer mais uma vez (profundidade `2`); um spawn que criaria um subagente de profundidade `3` é **recusado**. O limite padrão é **2**.

```an-diagram title="Proteção de profundidade de delegação (cap 2 padrão)" summary="Cada nível pode gerar um nível mais profundo até o limite; um spawn passado é recusado no lado do servidor."
{
  "html": "<div class=\"at-depth\"><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 0</span><strong>Chat de nível superior</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card ok\"><span class=\"diagram-pill\">depth 1</span><strong>Subagente</strong><small class=\"diagram-muted ok\">may spawn &darr;</small></div><div class=\"diagram-card warn\"><span class=\"diagram-pill warn\">depth 2</span><strong>Subagente's sub-agent</strong><small class=\"diagram-muted\">at the cap &mdash; may NOT spawn</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">depth 3</span><strong>Refused</strong><small class=\"diagram-muted\">server-side error</small></div></div>",
  "css": ".at-depth{display:flex;flex-direction:column;gap:8px}.at-depth .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.at-depth .rung-1,.at-depth .diagram-card:nth-child(2){margin-inline-start:24px}.at-depth .diagram-card:nth-child(3){margin-inline-start:48px}.at-depth .diagram-card:nth-child(4){margin-inline-start:72px}"
}
```

A aplicação é ambiental: cada subagente é executado dentro de um `AsyncLocalStorage` que registra sua própria profundidade, portanto, qualquer `spawnTask` alcançado transitivamente a partir dessa execução lê a profundidade de seu pai e recusa quando o limite é atingido - mesmo que a ferramenta `agent-teams` tenha sido entregue a um subagente que não deveria tê-la. A decisão é exposta como um `evaluateSubagentDepth(parentDepth)` puro e testável em unidade. Uma geração recusada retorna um erro claro: _"Limite de profundidade de delegação atingido (máx. N); não é possível gerar outro subagente."_

### Configurando o limite {#depth-guard-config}

Substitua o padrão no momento da implantação com `AGENT_NATIVE_MAX_SUBAGENT_DEPTH`:

| Valor          | Efeito                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(desativado)_ | Limite padrão de `2`.                                                                                                                                                |
| `0`            | **Nenhum subagente pode ser gerado** — o agente de nível superior faz todo o trabalho.                                                                               |
| `1`…`16`       | São muitos níveis de delegação.                                                                                                                                      |
| inválido/`>16` | Um valor não inteiro/negativo/NaN retorna para `2`; qualquer coisa acima de `16` é fixada em `16`, portanto, um erro de digitação nunca poderá desativar a proteção. |

```bash
AGENT_NATIVE_MAX_SUBAGENT_DEPTH=1   # subagentes são permitidos, mas não podem subdelegar
```

Quando um subagente está no limite ou abaixo dele, a estrutura injeta uma linha em seu contexto de tempo de execução informando a profundidade dele e se pode delegar mais, para que o modelo gaste seu orçamento de maneira adequada.

## O que vem a seguir

- [**Workspace — Custom Agents**](/docs/workspace#custom-agents) — o formato do perfil
- [**A2A Protocol**](/docs/a2a-protocol) — quando o "subagente" mora em um aplicativo totalmente diferente
- [**Actions**](/docs/actions) — as ferramentas que um subagente chama
