---
title: "Conceitos-chave"
description: "Como funcionam os aplicativos nativos de agente: actions primeiro, banco de dados SQL, loop de agente de aplicativo, UI opcional, sincronização de pesquisa, pontos de entrada de agente externo, reconhecimento de contexto e portabilidade."
---

# Conceitos-chave

Como os aplicativos nativos do agente funcionam nos bastidores — os princípios e a arquitetura. Esta página é o contrato; para ver a visão e os argumentos para construir desta forma, consulte [What Is Agent-Native?](/docs/what-is-agent-native).

## A arquitetura {#the-architecture}

Cada aplicativo nativo do agente consiste em três coisas trabalhando juntas:

> **Agente** — IA autônoma que lê dados, grava dados, executa actions e modifica código. Personalizável com skills e instruções.
>
> **Aplicação** — A superfície do produto ao redor do agente. Inicialmente, isso pode ser apenas ação, bate-papo avançado, um pequeno plano de controle ou um UI React completo com painéis, fluxos e visualizações.
>
> **Computador** — Banco de dados, navegador, execução de código. Os agentes trabalham diretamente com SQL e ferramentas integradas; Os servidores MCP são complementos opcionais, não a base.

```an-diagram title="Agente, aplicativo e computador" summary="Três camadas trabalhando juntas em um armazenamento SQL compartilhado. O agente e o aplicativo leem e gravam os mesmos dados."
{
  "html": "<div class=\"diagram-arch\"><div class=\"diagram-row\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">lê e grava dados, executa ações, modifica código</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Application</span><small class=\"diagram-muted\">action-only, chat, control plane, or full UI React</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;&nbsp;&uarr;</div><div class=\"diagram-box\" data-rough>Computer<br><small class=\"diagram-muted\">banco de dados SQL · browser · code execution</small></div></div>",
  "css": ".diagram-arch{display:flex;flex-direction:column;align-items:center;gap:10px}.diagram-arch .diagram-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.diagram-arch .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:220px}.diagram-arch .diagram-arrow{font-size:20px;line-height:1}.diagram-arch .diagram-box{text-align:center;padding:12px 18px}"
}
```

Aplicativos headless podem executar o mesmo loop de agente de aplicativo de produção a partir da pasta com `pnpm agent`, enquanto aplicativos UI montam o painel do agente integrado e são executados localmente com `pnpm dev`. Na nuvem, o Builder.io fornece um quadro gerenciado — o ambiente que hospeda o agente próximo ao seu aplicativo — com colaboração, edição visual e infraestrutura gerenciada para equipes.

## Blocos de construção do agente {#agent-building-blocks}

Todo aplicativo nativo de agente tem os mesmos blocos de construção de agente, independentemente de
a superfície do produto é headless, chat-first ou UI completo:

```an-file-tree title="Orientação e comportamento"
{
  "entries": [
    { "path": "AGENTS.md", "note": "Instruções sempre ativas: propósito, regras centrais, chaves de estado, índice de actions, índice de skills" },
    { "path": ".agents/skills/<name>/SKILL.md", "note": "Comportamento reutilizável: etapas de workflow, políticas, exemplos, referências e listas do que fazer/não fazer" },
    { "path": "actions/<name>.ts", "note": "Capacidade executável: operação tipada exposta ao agente, UI, CLI, HTTP, MCP, A2A, jobs e webhooks" }
  ]
}
```

| Bloco de construção | Use-o para                                                                                                                        | Carregado quando                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Instruções**      | Orientação estável que o agente deve levar em cada tarefa: o que é o aplicativo, invariantes, tom, índices                        | Cada turno                                                               |
| **Skills**          | Comportamento reutilizável: como seguir um fluxo de trabalho, aplicar uma política, inspecionar evidências ou verificar uma saída | Sob demanda quando a descrição da habilidade corresponde à tarefa        |
| **Actions**         | Operações reais: ler ou gravar dados, chamar APIs, enviar mensagens, executar aprovações, produzir resultados digitados           | Listadas como ferramentas a cada passo; executado somente quando chamado |

Skills e actions trabalham juntos. Uma habilidade ensina o agente a fazer uma aula de
trabalho; uma ação é o caminho do código que ela pode chamar enquanto realiza esse trabalho. Por exemplo,
uma habilidade `customer-research` pode informar ao agente quais fontes inspecionar e
como resumir evidências, enquanto `search-crm` e `create-brief` actions buscam
e escreva os dados reais.

Seis regras governam a arquitetura:

1. **Os dados residem em SQL** — todo o estado do aplicativo reside no banco de dados via Drizzle ORM
2. **Toda a IA passa pelo agente** — nenhuma chamada LLM inline
3. **Actions para operações de agente** — trabalhos complexos são executados como actions
4. **A sincronização ao vivo mantém o UI sincronizado** — as alterações do banco de dados são transmitidas pelo SSE com polling como substituto universal
5. **O agente pode modificar o código** — o aplicativo evolui conforme você o usa
6. **Estado do aplicativo em SQL** — o estado efêmero UI reside no banco de dados, legível pelo agente e pelo UI

## A lista de verificação de quatro áreas {#four-area-checklist}

Cada recurso voltado para o usuário deve atualizar todas as áreas aplicáveis. Ignorar uma área aplicável quebra o contrato do agente nativo; forçar um UI em um primitivo somente de ação também é um cheiro.

| Área                        | Descrição                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| **1. UI**                   | Página, componente ou caixa de diálogo com a qual o usuário interage       |
| **2. Ação**                 | Ação que pode ser chamada pelo agente em actions/ para a mesma operação    |
| **3. Skills**               | Atualize AGENTS.md e/ou crie uma habilidade documentando o padrão          |
| **4. Estado do aplicativo** | Estado de navegação, dados da tela de visualização e comandos de navegação |

Um recurso com apenas UI é invisível para o agente. Um recurso UI completo com apenas actions é invisível para o usuário. Um recurso sem estado de aplicativo significa que o agente não sabe o que o usuário está fazendo. Uma operação headless pode começar legitimamente com ação + instruções e adicionar UI/estado do aplicativo posteriormente, quando humanos precisarem navegar, aprovar, configurar ou compartilhá-lo.

## Dados em SQL {#data-in-sql}

Todo o estado do aplicativo reside em um banco de dados SQL com Drizzle ORM. Os esquemas são independentes do provedor; os bancos de dados suportados, a configuração do `DATABASE_URL` e as regras de portabilidade residem no [Database](/docs/database).

As lojas principais SQL são criadas automaticamente e estão disponíveis em todos os modelos:

- `application_state` — estado UI efêmero (navegação, rascunhos, seleções)
- `settings` — configuração de valor-chave persistente
- `oauth_tokens` — credenciais OAuth
- `sessions` — sessões de autenticação

```an-schema title="Lojas principais SQL" summary="Criado automaticamente em cada modelo — o agente e UI leem e gravam estes."
{
  "entities": [
    { "id": "application_state", "name": "application_state", "note": "Efêmero UI estado que o agente lê para obter contexto", "fields": [
      { "name": "key", "type": "text", "pk": true, "note": "por exemplo. 'navigation'" },
      { "name": "value", "type": "json", "note": "visualização, seleção, rascunhos" }
    ] },
    { "id": "settings", "name": "settings", "note": "Configuração de valor-chave persistente", "fields": [
      { "name": "key", "type": "text", "pk": true },
      { "name": "value", "type": "json" }
    ] },
    { "id": "oauth_tokens", "name": "oauth_tokens", "note": "OAuth credenciais", "fields": [
      { "name": "provider", "type": "text", "pk": true },
      { "name": "token", "type": "text" }
    ] },
    { "id": "sessions", "name": "sessions", "note": "Sessões de autenticação", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "userId", "type": "text" }
    ] }
  ]
}
```

```ts
// Drizzle schema for domain data
import { table, text, integer } from "@agent-native/core/db/schema";

export const forms = table("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schema: text("schema").notNull(), // JSON
  ownerEmail: text("owner_email"),
  createdAt: integer("created_at").notNull(),
});
```

```bash
# Ações principais para inspeção rápida do banco de dados e manutenção pontual
pnpm action db-schema                                       # show all tables
pnpm action db-query --sql "SELECT * FROM forms"
pnpm action db-exec --sql "UPDATE forms SET status = ? WHERE id = ?" --args '["closed","form-1"]'
# Cirúrgico find/replace em uma coluna de texto grande — envia uma comparação, não o valor inteiro
pnpm action db-patch --table documents --column content \
  --where "id='doc-1'" --find "old heading" --replace "new heading"
```

O plug-in de bate-papo do agente de produção permite gravações de banco de dados brutos por padrão
(`databaseTools: "write"`) para que os agentes possam corrigir dados de propriedade do aplicativo sem esperar por um
nova ação digitada. Essas gravações têm como escopo o usuário/organização autenticado. Definir
`databaseTools: "read"` para manter apenas a inspeção `db-schema` / `db-query` ou
`databaseTools: "off"` / `false` para exigir o aplicativo digitado actions para todos os dados
acesso.

## Ponte de bate-papo do agente {#agent-chat-bridge}

O UI nunca chama um LLM diretamente. Quando um usuário clica em “Gerar gráfico” ou “Escrever resumo”, o UI envia uma mensagem ao agente via `postMessage`. O agente faz o trabalho, com histórico completo de conversas, skills, instruções e capacidade de iteração.

```ts
// In a React component — delegate AI work to the agent
import { sendToAgentChat } from "@agent-native/core/client";

sendToAgentChat({
  message: "Generate a chart showing signups by source",
  context: "Dashboard ID: main, date range: last 30 days",
  submit: true,
});
```

Por que não chamar um LLM inline?

- **A IA não é determinística.** Você precisa de fluxo de conversa para fornecer feedback e iterar, e não botões únicos.
- **O contexto é importante.** O agente tem sua base de código completa, instruções, skills e histórico. Uma chamada in-line não tem nada disso.
- **O agente pode fazer mais.** Ele pode executar actions, navegar na Web, modificar código e encadear várias etapas.
- **Execução headless.** Como tudo passa pelo agente, qualquer aplicativo pode ser conduzido inteiramente de Slack, Telegram ou outro agente via [A2A](/docs/a2a-protocol).

## Sistema Actions {#actions-system}

Quando o agente precisa fazer algo complexo — chamar um API, processar dados, consultar o banco de dados — ele executa uma **ação**. Actions são arquivos TypeScript em `actions/` que exportam um `defineAction()` padrão:

```ts
// actions/fetch-data.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Fetch data from a source API.",
  schema: z.object({
    source: z.string().describe("Data source key, e.g. 'signups'"),
  }),
  run: async ({ source }) => {
    const res = await fetch(`https://api.example.com/${source}`);
    return await res.json();
  },
});
```

Uma chamada `defineAction()` fornece:

- **Ferramenta de agente** — o agente a vê com o esquema JSON derivado de zod e pode chamá-la.
- **Gancho de front-end** — `useActionMutation("fetch-data")` com inferência TypeScript completa.
- **Transporte de estrutura** — montado automaticamente atrás dos ganchos do cliente.
- **CLI** — `pnpm action fetch-data --source=signups` para scripts e loops de desenvolvimento de agente.
- **Ferramenta MCP / Ferramenta A2A** — quando o servidor MCP ou A2A está ativado, a mesma ação aparece lá também.

Mesma lógica, uma definição, conectada automaticamente a todos os consumidores. Consulte [Actions](/docs/actions) para referência completa.

## Sincronização ao vivo {#polling-sync}

As alterações do banco de dados são sincronizadas com UI por meio de `useDbSync()`. Fluxo de gravação do mesmo processo em `/_agent-native/events`; `/_agent-native/poll` continua sendo o substituto de processo cruzado e sem servidor. Quando o agente grava no banco de dados (estado do aplicativo, configurações ou dados de domínio), um contador de versão aumenta e o cliente invalida os caches de consulta React relevantes.

```ts
// Client: subscribe to agent/UI data changes once near the app shell
import { useDbSync } from "@agent-native/core/client";

useDbSync({ queryClient });
```

O fluxo é:

1. O agente executa uma ação que grava no banco de dados
2. O servidor emite um evento de alteração com uma fonte como `"action"` ou `"settings"`
3. `useDbSync` recebe por SSE ou pelo polling fallback
4. Rebusca de ganchos `useActionQuery` e ganchos `useQuery` com versão de origem
5. Os componentes renderizam os novos dados sem recarregar a página

```an-diagram title="Fluxo de sincronização ao vivo" summary="Uma gravação de agente se torna uma renderização de UI sem atualização manual - SSE primeiro, pesquisando como substituto universal."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-node\">Ação do agente<br><small class=\"diagram-muted\">grava no DB</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Evento de alteração<br><small class=\"diagram-muted\">source: action / settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">useDbSync</span><small class=\"diagram-muted\">SSE &middot; poll fallback</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Refetch da consulta<br><small class=\"diagram-muted\">renderiza, sem recarregar</small></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}.diagram-sync .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 14px}"
}
```

Isso funciona em todos os ambientes de implantação, inclusive sem servidor e de borda, porque usa o banco de dados, e não o estado da memória ou os observadores do sistema de arquivos.

## Quadros {#frames}

Um _frame_ é o ambiente que hospeda o agente próximo ao seu aplicativo – localmente esse é o painel incorporado; na nuvem é a superfície gerenciada do Builder.io. Consulte [Frames](/docs/frames).

Os aplicativos nativos do agente incluem um painel de agente incorporado que fornece o agente de IA junto com o aplicativo UI. É isso que faz a arquitetura funcionar: o agente precisa de um computador (banco de dados, navegador, execução de código) e o aplicativo precisa do agente para o trabalho de IA.

> **Painel de agente incorporado** — Bate-papo e terminal CLI opcional integrado em cada aplicativo. Suporta código Claude, Codex, Gemini, OpenCode e Builder.io. Executa localmente. Gratuito e de código aberto.
>
> **Nuvem** — Implante em qualquer nuvem com colaboração em tempo real, edição visual, funções e permissões. Melhor para equipes.

## Consciência do contexto {#context-awareness}

O agente sempre sabe o que o usuário está vendo. O UI grava uma chave `navigation` no estado do aplicativo em cada mudança de rota. O agente lê através da ação `view-screen` antes de agir.

Por exemplo, quando você abre uma conversa de e-mail, o UI insere uma linha como:

```json
{ "key": "navigation", "value": { "view": "thread", "threadId": "th_abc123" } }
```

O UI grava isso na mudança de rota; o agente lê (via `view-screen`) antes de realizar qualquer ação, para que ele sempre saiba em qual tópico (ou gráfico, ou slide) você está focado.

Veja [Context Awareness](/docs/context-awareness) para o padrão completo: estado de navegação, tela de visualização, comandos de navegação e prevenção de jitter.

## Uma ação, muitas superfícies {#protocols}

Implementar uma operação de domínio uma vez como uma ação; a estrutura expõe isso a todos os consumidores. O mesmo `defineAction()` se torna uma ferramenta de agente, um gancho UI com segurança de tipo, um endpoint HTTP, um comando CLI, uma ferramenta MCP e uma ferramenta A2A, com `link` opcional, `mcpApp` ou metadados de widget nativo explícitos adicionados apenas quando uma superfície precisa deles. Skills e instruções cobrem o comportamento.

Para obter a matriz completa de protocolo/superfície (servidor MCP e OAuth, aplicativos MCP, A2A, links diretos, widgets de bate-papo nativos, conectores AgentChatRuntime, Agent Web e o horizonte do adaptador para ACP e A2UI) e para escolher um formato de produto — sem interface, bate-papo rico, sidecar incorporado ou aplicativo completo — consulte [Agent Surfaces](/docs/agent-surfaces).

## Agente modifica código {#agent-modifies-code}

Este é um recurso, não um bug. O agente pode editar com segurança o código-fonte do aplicativo: componentes, rotas, estilos, actions.

Não há base de código compartilhada para quebrar. Você é o proprietário do aplicativo e o agente o desenvolve para você ao longo do tempo:

1. Bifurque um modelo (por exemplo, o modelo de análise)
2. Personalize perguntando ao agente
3. "Adicionar um novo tipo de gráfico para análise de coorte" — o agente o cria
4. "Conectar-se à nossa conta Stripe" — o agente escreve a integração
5. Seu aplicativo continua melhorando sem desenvolvimento manual

## Portátil por padrão {#hosting-agnostic}

Duas regras arquitetônicas mantêm os aplicativos portáteis entre bancos de dados e hosts:

- **Independente de banco de dados.** Escreva esquemas com `@agent-native/core/db/schema` e leia/grave com a consulta portátil Drizzle do DSL para que o mesmo código seja executado em qualquer provedor compatível. Use SQL bruto apenas para migrações aditivas ou manutenção única, mantido parametrizado e independente de dialeto. Consulte [Database](/docs/database).
- **Hosting-agnostic.** O servidor é executado em Nitro e compila para qualquer destino de implantação. Nunca use APIs específicos do nó (`fs`, `child_process`, `path`) em rotas de servidor ou plug-ins e nunca assuma um processo de servidor persistente - serverless e edge são stateless, portanto, mantenha todo o estado em SQL. Consulte [Deployment](/docs/deployment).

## Espaço de trabalho {#workspace}

Cada usuário recebe um **espaço de trabalho** pessoal — instruções, skills, memória, subagentes personalizados, trabalhos agendados e servidores MCP conectados — todos armazenados em SQL em vez de arquivos. Isso torna a personalização em nível de código Claude viável dentro de SaaS multilocatário sem criar um contêiner por usuário. Consulte [Workspace](/docs/workspace).

## Blocos de construção relacionados {#building-blocks}

Eles estão no mesmo contrato e têm seus próprios aprofundamentos:

- **[Dispatch](/docs/dispatch)** — o plano de controle do espaço de trabalho: caixa de entrada compartilhada, cofre de segredos, trabalhos agendados e um orquestrador que delega A2A a aplicativos especializados.
- **[Extensions](/docs/extensions)** — miniaplicativos Alpine.js em sandbox que o agente cria em tempo de execução, sem alterações de origem ou migrações.
- **[A2A Protocol](/docs/a2a-protocol)** — como aplicativos no mesmo espaço de trabalho descobrem e chamam uns aos outros por meio de JSON-RPC.

## O que você ganha de graça {#what-you-get-for-free}

Adotar o framework é valioso principalmente por causa do que você deixa de ter que construir. No momento em que seu aplicativo seguir as seis regras, você herdará:

- **Uma ação = cada superfície.** Cada ação definida com `defineAction()` é simultaneamente uma ferramenta de agente, um gancho de frontend typesafe (`useActionQuery`/`useActionMutation`), um transporte HTTP de propriedade da estrutura, um comando CLI, uma ferramenta MCP para clientes externos e uma ferramenta A2A para outros aplicativos nativos de agente. Os metadados `link` e `mcpApp` opcionais adicionam links diretos e aplicativos MCP UI sem uma segunda implementação.
- **Um espaço de trabalho completo por usuário.** Skills, `LEARNINGS.md` compartilhado, `memory/MEMORY.md` pessoal, `AGENTS.md`, subagentes personalizados, trabalhos agendados, servidores MCP conectados — todos com suporte de SQL, sem necessidade de caixa de desenvolvimento. Consulte [Workspace](/docs/workspace).
- **Componentes React integrados.** `<AgentPanel />` e `<AgentSidebar />` renderizam chat + espaço de trabalho em qualquer lugar do seu aplicativo. Consulte [Drop-in Agent](/docs/drop-in-agent).
- **Tempos de execução de bate-papo do agente BYO.** O mesmo bate-papo UI pode ser colocado sobre Agentes OpenAI, Respostas OpenAI, Agente Claude SDK, Vercel AI SDK, AG-UI ou seu próprio fluxo HTTP normalizado. Consulte [Native Interface de chat](/docs/native-chat-ui#byo-agent-runtimes).
- **Sincronização ao vivo entre o agente e UI.** O mesmo processo grava fluxo imediatamente em `/_agent-native/events`; uma pesquisa leve mantém as gravações sem servidor, cron e entre processos convergentes. A mutação actions invalida automaticamente as consultas baseadas em ação, de modo que os registros criados pelo agente aparecem sem atualização manual. Veja [Live Sync](#polling-sync) abaixo.
- **Auth, orgs, RBAC.** Better Auth com organizações/membros/funções está conectado para cada modelo. Consulte [Authentication](/docs/authentication).
- **Reconhecimento de contexto.** O agente sempre sabe o que o usuário está vendo por meio da chave de estado do aplicativo `navigation`. Consulte [Context Awareness](/docs/context-awareness).
- **Cliente + servidor MCP, ambas as direções.** O aplicativo ingere servidores MCP (locais, remotos, compartilhados por hub) _e_ expõe seu próprio actions como um servidor MCP. Consulte [MCP Clients](/docs/mcp-clients) e [MCP Protocol](/docs/mcp-protocol).
- **Delegação entre aplicativos.** Agentes em diferentes aplicativos conversam pelo [A2A](/docs/a2a-protocol). Implantações de mesma origem ignoram JWT; origem cruzada usa um `A2A_SECRET` compartilhado.
- **Equipes de subagentes.** Gere um subagente com seu próprio tópico e ferramentas, exibido como um chip embutido no bate-papo. Consulte [Agent Teams](/docs/agent-teams).
- **Portabilidade.** Qualquer banco de dados SQL compatível com Drizzle, qualquer host compatível com Nitro (Node, Workers, Netlify, Vercel, Deno, Lambda, Bun).

Esse é o "e tudo mais" que você mesmo estaria colando.

## Aprofundamentos {#deep-dives}

Para orientação detalhada sobre padrões específicos:

- [What Is Agent-Native?](/docs/what-is-agent-native) — a visão e a filosofia
- [Context Awareness](/docs/context-awareness) — estado de navegação, tela de visualização, comandos de navegação
- [Skills Guide](/docs/skills-guide) — estrutura skills, domínio skills, criação de skills personalizado
- [Native Interface de chat](/docs/native-chat-ui) — tabelas declaradas por ação, gráficos e postura de tempo de execução BYO
- [Agent Surfaces](/docs/agent-surfaces) — bate-papo avançado e sem interface, sidecar incorporado e caminhos de aplicativos completos
- [A2A Protocol](/docs/a2a-protocol) — comunicação entre agentes
- [Multi-App Workspace](/docs/multi-app-workspace) — hospede vários aplicativos em um monorepo com autenticação compartilhada, skills, componentes e credenciais
