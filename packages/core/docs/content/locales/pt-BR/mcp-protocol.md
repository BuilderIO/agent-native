---
title: "Protocolo MCP"
description: "Exponha seu aplicativo nativo do agente como um servidor MCP remoto para que Claude, ChatGPT, código Claude, cursor e outras ferramentas de IA possam chamar o actions do seu aplicativo diretamente."
---

# Protocolo MCP

**Esta página: a referência do servidor MCP de nível inferior.** Como cada aplicativo nativo do agente expõe seu actions sobre MCP — o endpoint montado automaticamente, modos de autenticação, a superfície `tools/call`/`ask-agent` e montagem personalizada. Procure-o quando precisar de recursos internos do servidor; para conectar um host, comece com [External Agents](/docs/external-agents).

| Se você quiser…                                                                                  | Ler                                      |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Conecte um agente/host externo ao seu aplicativo                                                 | [External Agents](/docs/external-agents) |
| Dê mais ferramentas ao seu agente (consuma outros servidores MCP)                                | [MCP Clients](/docs/mcp-clients)         |
| Crie UIs embutidos que renderizam em Claude/ChatGPT                                              | [MCP Apps](/docs/mcp-apps)               |
| Referência do servidor MCP de nível inferior (autenticação, ferramentas, montagem personalizada) | **Esta página** — Protocolo MCP          |

Cada aplicativo nativo do agente expõe automaticamente um servidor MCP (Model Context Protocol) remoto, para que ferramentas externas de IA como Claude, aplicativos MCP personalizados ChatGPT, código Claude, Cursor, Codex e VS Code GitHub Copilot possam descobrir e chamar o actions do seu aplicativo diretamente, sem necessidade de código extra. Se seu objetivo é _conectar_ um desses hosts a um aplicativo hospedado, [External Agents](/docs/external-agents) abrange o conector de despacho único recomendado, URLs por aplicativo, OAuth, MCP aplicativos UIs em linha e links diretos. Esta página documenta o que está por baixo disso.

## Visão geral {#overview}

MCP é o protocolo padrão para conectar ferramentas de IA a recursos externos. Quando você implanta um aplicativo nativo do agente, ele monta automaticamente um endpoint MCP junto com o endpoint A2A existente. Qualquer cliente compatível com MCP pode se conectar e usar as ferramentas do seu aplicativo.

Conceitos principais:

- **Montado automaticamente** — todos os aplicativos recebem `/_agent-native/mcp` gratuitamente, sem necessidade de configuração
- **Streamable HTTP** — usa o transporte MCP moderno sobre o HTTP padrão (POST + SSE)
- **Mesmo actions** — exatamente o mesmo registro de ação que alimenta o chat do agente e o A2A
- **Ferramenta `ask-agent`** — uma metaferramenta que delega tarefas complexas ao loop completo do agente
- **Aplicativos MCP** — actions pode anunciar recursos UI interativos por meio da extensão `io.modelcontextprotocol/ui` oficial
- **MCP remoto padrão OAuth** — descoberta OAuth 2.1, registro dinâmico de cliente, código de autorização + PKCE, rotação de token de atualização
- **Bearer auth fallback** — usa `ACCESS_TOKEN`, `ACCESS_TOKENS` ou JWTs criados por conexão para clientes que não podem executar OAuth

```an-diagram title="Seu aplicativo como um servidor MCP" summary="Hosts externos se conectam por Streamable HTTP. Cada ação é uma ferramenta; ask-agent delega para o loop completo do agente."
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP versus A2A {#mcp-vs-a2a}

Ambos os protocolos são montados automaticamente. Use o que for mais adequado ao seu caso de uso:

|                               | MCP                                                                    | A2A                                                |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| **Melhor para**               | Ferramentas externas que chamam seu aplicativo                         | Comunicação entre agentes                          |
| **Protocolo**                 | MCP HTTP transmitível                                                  | JSON-RPC 2.0                                       |
| **Descoberta de ferramentas** | `tools/list`                                                           | Cartão de agente em `/.well-known/agent-card.json` |
| **Ponto final**               | `/_agent-native/mcp`                                                   | `/_agent-native/a2a`                               |
| **Apoiado por**               | Claude, ChatGPT, Claude Code, Cursor, Codex, Cowork e outros hosts MCP | Outros aplicativos nativos do agente               |
| **Execução**                  | Chamadas diretas de ferramenta (sem LLM extra)                         | Loop completo do agente (raciocínio LLM)           |

Você também pode usar a ferramenta `ask-agent` MCP para obter o melhor dos dois mundos: chame-a do código Claude e deixe o agente do seu aplicativo raciocinar através de tarefas complexas.

## Configuração manual do cliente MCP {#manual-config}

Para a configuração recomendada de um comando, use [External Agents](/docs/external-agents). Se você estiver escrevendo à mão a configuração MCP para um cliente compatível com OAuth, adicione seu aplicativo como um servidor MCP remoto sem cabeçalhos estáticos:

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

Ou escreva a entrada manualmente em `.mcp.json` (escopo do projeto) ou `~/.claude.json` (escopo do usuário):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

Em seguida, execute `/mcp` no código Claude e escolha **Autenticar**. Para clientes que não podem executar MCP OAuth remoto, use a página Conectar ou uma entrada de token de portador estático com `headers.Authorization`. Depois de autenticado, você poderá usar as ferramentas do seu aplicativo naturalmente:

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## Conectando-se de outros clientes MCP {#other-clients}

Qualquer cliente MCP que suporte o transporte Streamable HTTP pode se conectar. O ponto final é:

```
POST https://your-app.example.com/_agent-native/mcp
```

O servidor suporta o handshake MCP padrão: `initialize` → `initialized` → `tools/list` → `tools/call`.

```an-api title="MCP ponto final" summary="O endpoint Streamable HTTP montado automaticamente que todo aplicativo nativo do agente expõe."
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP Endpoint HTTP transmitível",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

Se uma ação declarar `mcpApp`, o servidor também anunciará a extensão oficial de aplicativos MCP (`io.modelcontextprotocol/ui`) e oferecerá suporte a `resources/list`, `resources/templates/list` e `resources/read` para o recurso do aplicativo. Hosts que renderizam aplicativos MCP podem mostrar o UI inline; hosts que não o fazem ainda podem chamar a ferramenta e usar o fallback de link direto. Os produtos UIs devem usar `embedApp()` para que a superfície inline seja a rota real do aplicativo React ou uma rota focada que renderize um componente React compartilhado, como um gráfico do Analytics, e não uma implementação HTML simples e separada. O servidor emite metadados de aplicativos MCP padrão e metadados de compatibilidade de aplicativos ChatGPT SDK para que hosts compatíveis com aplicativos possam encontrar o mesmo recurso `ui://`. A matriz de extensão oficial atual inclui Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT e Cursor; o suporte do host varia de acordo com a versão e o plano, portanto, use o [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) para orientação ao usuário.

### Ponte incorporada do aplicativo MCP {#mcp-app-embed-bridge}

`embedApp()` é o URL-primeiro ajudante de aplicativo MCP de baixo nível: ele inicia um aplicativo assinado
rota em linha por meio de transplante (Claude), quadro controlado (ChatGPT) ou direto
navegação, medeia o host actions pela ponte `ui/*` JSON-RPC (e o
`agentNative.mcpHost.*` retransmissão postMessage para o caminho do quadro controlado) e
fixa a altura do shell de recursos para que uma rota de aplicativo completo não seja renderizada como
artefato de bate-papo enorme.

Consulte [MCP Apps](/docs/mcp-apps#mcp-app-bridge) para obter detalhes completos da ponte incorporada: transplante vs quadro controlado, as tabelas `ui/*` e postMessage, `create_embed_session` / `embedStartUrl`, CSP e regras de domínio, incorporação de extensão `srcDoc`, fixação de altura e o cliente de ponte de host API.

## Ferramentas {#tools}

Cada chamador recebe um **catálogo compacto por padrão** (aplicativo declarado por modelo actions mais os recursos integrados entre aplicativos), com a superfície de ação completa exibida apenas com aceitação explícita e `tool-search` sempre disponível para alcançar o restante. Consulte [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers) para obter a explicação completa.

Cada ação é mapeada diretamente para uma ferramenta MCP:

| Propriedade da ação | Propriedade da ferramenta MCP |
| ------------------- | ----------------------------- |
| `tool.description`  | `description`                 |
| `tool.parameters`   | `inputSchema`                 |
| Nome da ação        | Nome da ferramenta            |

Quando `mcpApp` está presente, a entrada da ferramenta também inclui `_meta.ui.resourceUri`, `_meta["ui/resourceUri"]` e `_meta["openai/outputTemplate"]`, e o recurso `ui://` correspondente é retornado como `text/html;profile=mcp-app`.

### A ferramenta `ask-agent` {#ask-agent}

Além das ferramentas de ação individuais, cada servidor MCP inclui uma meta-ferramenta `ask-agent`. Isso envia uma mensagem em linguagem natural ao agente de IA do aplicativo e retorna a resposta.

Use `ask-agent` para tarefas complexas que se beneficiam do raciocínio e do contexto do agente:

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

O agente executa o mesmo loop que o bate-papo interativo: ele pode chamar diversas ferramentas, raciocinar sobre o contexto e produzir uma resposta cuidadosa.

## Autenticação {#authentication}

O endpoint MCP suporta MCP remoto padrão OAuth mais o substituto de token de portador existente:

| Modo                                  | Como funciona                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Padrão MCP OAuth                      | O cliente descobre a autenticação de `WWW-Authenticate`, registra, executa PKCE e envia `Authorization: Bearer <access-token>` |
| JWT conectado-cunhado                 | `npx @agent-native/core@latest connect` / a página Connect cria um JWT revogável por usuário                                   |
| `ACCESS_TOKEN`                        | Token de portador estático — cliente envia `Authorization: Bearer <token>`                                                     |
| `ACCESS_TOKENS`                       | Lista separada por vírgula de tokens de portador estáticos válidos                                                             |
| `A2A_SECRET`                          | Autenticação baseada em JWT — os tokens são verificados criptograficamente                                                     |
| _(nenhum definido, somente loopback)_ | Não é necessária autenticação para testes de desenvolvimento local                                                             |

Para hosts MCP compatíveis com OAuth, configure o servidor remoto URL sem cabeçalhos estáticos:

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

A primeira solicitação MCP não autenticada recebe:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

Endpoints de descoberta:

| Ponto final                               | Propósito                                                  |
| ----------------------------------------- | ---------------------------------------------------------- |
| `/.well-known/oauth-protected-resource`   | Metadados de recursos protegidos RFC 9728                  |
| `/.well-known/oauth-authorization-server` | Metadados do servidor de autorização OAuth                 |
| `/_agent-native/mcp/oauth/register`       | Registro dinâmico de cliente público                       |
| `/_agent-native/mcp/oauth/authorize`      | Autorização + consentimento do navegador                   |
| `/_agent-native/mcp/oauth/token`          | Concessões de código de autorização e token de atualização |

```an-diagram title="Fluxo de descoberta OAuth" summary="Um 401 inicia a descoberta, o registro e uma autorização PKCE → troca de tokens. O token Bearer é vinculado ao público e tem escopo definido."
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">vinculado à audiência · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

Tokens de acesso são JWTs assinados cujo público é exatamente o recurso MCP URL. O servidor aceita apenas tokens emitidos para si mesmo e aplica escopos antes de listar/chamar ferramentas:

| Escopo      | Permite                                             |
| ----------- | --------------------------------------------------- |
| `mcp:read`  | actions somente leitura                             |
| `mcp:write` | mutação de actions e `ask-agent`                    |
| `mcp:apps`  | Recursos de aplicativos MCP (recursos `ui://` HTML) |

Os tokens de atualização são armazenados apenas como hashes e são alternados a cada atualização. `npx @agent-native/core@latest connect` grava esta entrada OAuth somente URL para clientes de código Claude por padrão; mantenha a página Connect, `npx @agent-native/core@latest connect --token <token>` e a configuração do portador estático para proxy stdio local, clientes mais antigos e fluxos de emergência/depuração.

## Configuração MCP personalizada {#custom-setup}

O servidor MCP é montado automaticamente pelo plugin de chat do agente. Para a maioria dos aplicativos, nenhuma configuração é necessária. Se precisar de um comportamento personalizado, você pode montá-lo manualmente em um plugin de servidor:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## Exemplo: análises do código Claude {#example}

Você tem um aplicativo de análise implantado em `analytics.example.com`. Do código Claude:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

Ou adicione manualmente em `.mcp.json`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

Agora no código Claude:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

Para análises mais complexas:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
