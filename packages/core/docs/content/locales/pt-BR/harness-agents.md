---
title: "Agentes de aproveitamento"
description: "Execute código Claude, Codex, Pi e outros equipamentos de codificação completos como agentes incorporados dentro do Agent-Native, com seu próprio loop, sandbox, ferramentas nativas e sessões recuperáveis apoiadas por SQL."
search: "agentes de aproveitamento AgentHarness ai-sdk HarnessAgent Código Claude Codex Pi Cursor Mastra agente de codificação incorporado resolveAgentHarness startAgentHarnessRun ferramentas de host de sandbox de sessão recuperável"
---

# Agentes de aproveitamento

> **Para quem se destina:** autores de host conectando um tempo de execução de codificação completo (Código Claude,
> Codex, Pi) em Agent-Native como agente. Construindo um aplicativo? Comece com
> [Creating Templates](/docs/creating-templates).

Um agente de aproveitamento é um tempo de execução de agente completo — Código Claude, Codex, Pi e similares —
que possui seu próprio loop, espaço de trabalho, ferramentas de arquivo nativas, estado de sessão, compactação,
modelo de aprovação e comportamento do sandbox. Agent-Native executa isso através do
**`AgentHarness`** substrato em `@agent-native/core/agent/harness`, transmite seu
eventos na transcrição normal e persiste sua sessão nativa em um thread
pode pausar e retomar.

Isso é diferente do agente de bate-papo integrado e de trazer seu próprio bate-papo
tempo de execução. O agente integrado e `AgentEngine` são para um modelo de ida e volta
abaixo de `runAgentLoop`. Um chicote não é um provedor `AgentEngine` — ele executa seu
próprio loop de ponta a ponta, então Agent-Native o conduz como uma sessão, não como uma única
chamada de modelo.

```an-diagram title="Um arnês possui seu laço; Agent-Native conduz a sessão" summary="O AgentHarness substrato creates/resumes a sessão nativa, transmite seus eventos para a transcrição normal e persiste resumeState em SQL entre os turnos."
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Qual documento de codificação eu quero? {#which-doc}

| Você quer…                                                                               | Usar                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Execute o código Claude / Codex / Pi **como agente**, com seu próprio loop + ferramentas | **Agentes de aproveitamento** (esta página)  |
| Renderizar um espaço de trabalho de codificação estilo Claude/Codex **UI**               | [Agent-Native Code UI](/docs/code-agents-ui) |
| Troque o back-end que executa a **ferramenta `run-code`** do agente                      | [Adapters](/docs/sandbox-adapters)           |
| Prepare uma ferramenta CLI (`gh`, `ffmpeg`) para o agente ligar                          | [Adapters](/docs/sandbox-adapters)           |

Superfícies adjacentes: coloque um agente que você construiu em outro lugar atrás do bate-papo de Agent-Native
UI com [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes); deixe um
chamada de host MCP externa em seu aplicativo via [External Agents](/docs/external-agents);
gerar execução de segundo plano/subagente com [Custom Agents & Teams](/docs/agent-teams).

## Arnês embutidos {#built-in}

`registerBuiltinAgentHarnesses()` registra três adaptadores apoiados pelo AI SDK
`HarnessAgent`:

| Nome                         | Tempo de execução | Caixa de areia | Aprovações |
| ---------------------------- | ----------------- | -------------- | ---------- |
| `ai-sdk-harness:claude-code` | Código Claude     | sim            | sim        |
| `ai-sdk-harness:codex`       | Codex             | sim            | não        |
| `ai-sdk-harness:pi`          | Pi                | não            | sim        |

Seus pacotes de tempo de execução são **dependências de pares opcionais** e carregam lentamente, portanto,
aplicativo que nunca usa arnês não paga por isso. Cada adaptador carrega um
Dica `installPackage` (por exemplo `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness` lança uma instalação clara
erro se os pacotes estiverem faltando e `isAgentHarnessPackageInstalled(entry)`
permite verificar primeiro.

`registerBuiltinAgentHarnesses()` também registra os chicotes [ACP](#acp)
(`acp`, `acp:gemini`, `acp:claude-code`).

## Agentes ACP {#acp}

Agent-Native pode atuar como um [ACP](https://agentclientprotocol.com) (Agente Cliente
Protocolo) **cliente** e acione um agente de codificação local — Gemini CLI, Claude Code,
ou qualquer agente compatível com ACP — através deste mesmo substrato. O agente é executado como um
subprocesso local que fala JSON-RPC delimitado por nova linha sobre stdio; Editor do ACP
↔ o modelo do agente tem exatamente esse formato.

Este adaptador tem como escopo **codificação local**. O processo filho herda o
ambiente pai, para que o agente reutilize qualquer login CLI local que já possua
(por exemplo, autenticação `gemini` ou `claude` no diretório inicial do usuário). Não é um
transporte hospedado ou em sandbox, e não é um transporte chat/A2A — para esses,
veja [Agent Surfaces](/docs/agent-surfaces).

| Nome              | Comando padrão                                 | Recuperável\* |
| ----------------- | ---------------------------------------------- | ------------- |
| `acp`             | _(forneça `command`/`args` via configuração)_  | sim           |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp` | sim           |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`       | sim           |

\*Resume funciona quando o agente anuncia o recurso `loadSession` e
caso contrário, será degradado para uma nova sessão.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

O transporte do protocolo (`@zed-industries/agent-client-protocol`) é opcional
dependência carregada lentamente através da dica `installPackage`, assim como o AI SDK
arreios. O próprio binário do agente (`@google/gemini-cli`,
`@zed-industries/claude-code-acp`,…) é um CLI externo separado; as predefinições
inicie-o através de `npx` e o comando/args permanecerá substituível porque o agente ACP
os sinalizadores de entrada ainda evoluem.

`permissionMode` mapeia para ACP `session/request_permission` usando a chamada de ferramenta
digite os relatórios do agente: leituras sempre executadas, edições executadas em `allow-edits` e
tudo que é arriscado avisa, a menos que `allow-all`. As aprovações aparecem normalmente
Eventos `approval-request`. O adaptador serve `fs/read_text_file` e
`fs/write_text_file` no espaço de trabalho da sessão (recusando caminhos que escapam
it) e as gravações emitem eventos `file-change`; métodos de terminal não são anunciados,
portanto, o agente usa seu próprio shell.

## Autenticação Codex: Código UI versus sandboxes de chicote {#codex-auth}

Existem duas superfícies Codex e elas autenticam de maneira diferente:

- **Agent-Native Code / Desktop** executa `codex exec` na máquina do usuário. Se
  o usuário executou `codex login`, esta execução local reutiliza qualquer ChatGPT
  assinatura ou chave API autentica os relatórios Codex CLI instalados por meio de
  `codex login status`.
- **`ai-sdk-harness:codex`** carrega `@ai-sdk/harness-codex`, que aciona Codex
  dentro da caixa de proteção do chicote através de `@openai/codex-sdk`. Não acontece silenciosamente
  herdar o login do usuário Desktop `~/.codex` porque o sandbox pode ser remoto
  ou isolado. Para sandboxes confiáveis/privadas, opte por `codexCliAuth: true`;
  Agent-Native copia o arquivo de autenticação local Codex CLI para o sandbox antes do
  arnês começa. Para sandboxes hospedados ou compartilhados, configure API-key/gateway
  autenticação.

Então, se alguém perguntar qual pacote carrega o caminho Codex OAuth: para codificação local
sessões, use `@agent-native/core` / Desktop mais o instalado
`@openai/codex` CLI e `codex login`. Para `ai-sdk-harness:codex` em sandbox,
use a opção `codexCliAuth` explícita ao copiar esse login para o sandbox
é aceitável.

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` lê `CODEX_HOME/auth.json` ou `~/.codex/auth.json`. Para
aponte para um login local diferente, passe
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` ou
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## Registrar e resolver {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)` retorna um `AgentHarnessAdapter`. O
O `config` opcional é encaminhado para a fábrica do adaptador — para os adaptadores AI SDK
que mapeia para `AiSdkHarnessAdapterOptions` (`label`, `description`,
`permissionMode`, `harnessOptions`, `agentOptions` e Codex somente
`codexCliAuth`). Use `listAgentHarnesses()` para enumerar o que está registrado
um seletor.

## Fazer uma curva {#run-a-turn}

`startAgentHarnessRun` conecta uma sessão de aproveitamento ao gerenciador de execução compartilhado
ciclo de vida. Ele cria (ou reutiliza) a sessão nativa, persiste, transmite o
por sua vez, traduz cada evento de aproveitamento em eventos de transcrição e desanexa o
estado retomável quando o turno termina.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun` retorna o `ActiveRun` do run-manager, então é a vez
aparece através das rotas de corrida, transcrição e cancelamento existentes, assim como
qualquer outro agente executado. Passe um `session` já criado em vez de `createSession`
para continuar uma sessão que você está mantendo na memória.

## Sessões e currículo {#sessions}

Um chicote possui um estado de sessão nativo de longa duração. Agent-Native persiste em SQL
para que um thread possa sobreviver entre turnos, processos e implantações. O `resumeState`
é **opaco** — Agent-Native armazena e devolve, mas nunca inspeciona ou
interpreta.

```an-diagram title="Retome entre turnos, processos e implantações" summary="Cada turno separa um resumeState opaco em SQL; no próximo turno, ele retorna para createSession em vez de reproduzir o histórico do bate-papo."
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>Turno N<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">opaco · sessão de harness SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>Turno N+1<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

A loja também expõe `saveAgentHarnessSession`, `updateAgentHarnessSession`,
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped` e `ensureAgentHarnessSessionTables`.
`startAgentHarnessRun` chama os caminhos salvar/atualizar/parar para você; alcançá-los
diretamente apenas em um host personalizado.

## Ferramentas e permissões do host {#host-tools}

Um chicote traz suas próprias ferramentas nativas (leitura, edição, gravação, shell e assim por diante), então
você **não** expõe novamente a edição de arquivos como ferramentas de host. Passe apenas por **estreito,
conjunto intencional** de Agent-Native actions até `createSession.tools` quando você
deseja que o equipamento atinja operações específicas do aplicativo e mantenha `defineAction`
autenticação, contexto de solicitação, tempos limite, truncamento e metadados somente leitura intactos quando
você faz.

`permissionMode` determina o que o chicote pode fazer sem aprovação:

| Modo          | Significado                                                       |
| ------------- | ----------------------------------------------------------------- |
| `allow-reads` | Padrão. Leituras executadas; edições e prompt actions arriscado   |
| `allow-edits` | Leituras e edições são executadas; outro prompt actions arriscado |
| `allow-all`   | Sem restrição de aprovação                                        |

Quando um arnês faz uma pausa para aprovação, ele emite um evento `approval-request` e o
a sessão é marcada como `idle` com a aprovação pendente registrada, para que UI possa
dê-lo à tona e retome a decisão do usuário. Veja
[Human Approval](/docs/human-approval) para a superfície de aprovação.

## Eventos {#events}

Uma sessão de aproveitamento transmite valores `AgentHarnessEvent`, que Agent-Native
traduz-se para o fluxo `AgentChatEvent` padrão com
`agentHarnessEventToAgentChatEvents`. A união de eventos cobre `text-delta`,
`thinking-delta`, `activity`, `tool-start`, `tool-done` (que pode carregar um
carga útil `mcpApp` para widgets nativos), `approval-request`, `file-change`,
`compaction`, `usage`, `error` e `done`. Como os resultados da ferramenta fluem pelo
mesma tradução, widgets nativos declarados por ação ainda são renderizados — consulte
[Native Interface de chat](/docs/native-chat-ui).

## Execuções em segundo plano e UI {#background-runs}

O Harness executa o projeto no formato `BackgroundAgentRun` compartilhado com
`createAgentHarnessBackgroundAgentController()` e estão disponíveis através do
rotas de execução existentes como `goalId=agent-harness`. Isso significa um Claude de longa duração
O código ou a sessão Codex aparece nas mesmas superfícies de execução em segundo plano e de transcrição
como equipes de agentes e outros adaptadores, com `listAgentHarnessBackgroundRuns`,
`listAgentHarnessBackgroundTranscriptEvents`, `getAgentHarnessBackgroundRun` e
`stopAgentHarnessBackgroundRun` disponível para hosts personalizados.

## Adaptadores personalizados {#custom-adapters}

Para agrupar um tempo de execução que não seja um dos integrados, implemente
`AgentHarnessAdapter` e registre-o. O adaptador declara seus recursos e
cria sessões; uma sessão expõe `streamTurn` e `continueTurn` opcional,
`approve`, `detach`, `stop` e `destroy`.

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

Mantenha o pacote de tempo de execução opcional com uma importação dinâmica em `createSession` e um
Dica `installPackage`. Para chicotes de codificação apoiados por ponte, é necessário um
provedor de sandbox/espaço de trabalho em vez de executar um agente de codificação arbitrário no
processo host — consulte [Sandbox Adapters](/docs/sandbox-adapters). O adaptador AI SDK
(`createAiSdkHarnessAdapter`, apoiado por `HarnessAgent` de `@ai-sdk/harness`) é
uma implementação deste contrato, não a abstração pública.

## Não {#donts}

- Não adicione código Claude, Codex, Cursor, Mastra ou Pi como um `AgentEngine`. Eles
  possuem seu loop; executar um em `AgentEngine.stream()` executa o loop duas vezes
  e perde a semântica do ciclo de vida da sessão.
- Não reproduza todo o histórico de bate-papo do Agent-Native em um chicote a cada turno. Currículo
  a sessão de aproveitamento com seu `resumeState`.
- Não armazene `resumeState` em `application_state`. Pertence ao arnês
  tabela da sessão SQL.
- Não exponha todas as ações do aplicativo a todas as sessões de aproveitamento por padrão. Entregue um
  conjunto de ferramentas pequeno e intencional.

## Documentos relacionados {#related-docs}

- [Native Interface de chat](/docs/native-chat-ui) — coloque seu próprio agente por trás do bate-papo UI com `AgentChatRuntime`.
- [Agent Surfaces](/docs/agent-surfaces) — escolha headless, chat, sidecar ou aplicativo completo.
- [Agent-Native Code UI](/docs/code-agents-ui) — a superfície reutilizável do espaço de trabalho de codificação.
- [Custom Agents & Teams](/docs/agent-teams) — execuções em segundo plano e delegação de subagentes.
- [Sandbox Adapters](/docs/sandbox-adapters) — back-ends de execução conectáveis para chicotes de codificação.
- [Human Approval](/docs/human-approval) — o chicote de superfície aprovado é usado.
