---
title: "Incorporando SDK"
description: "Incorpore um arquivo secundário Agent-Native em um aplicativo SaaS existente com contexto de página e comandos de host."
---

# Incorporando SDK

Incorpore Agent-Native em um produto existente: mantenha seu aplicativo SaaS, adicione um durável
arquivo secundário do agente e permitir que esse agente veja e opere na página em que o usuário está
já estou usando. Se você ainda está decidindo entre agentes sem cabeça, chat avançado e
arquivo secundário incorporado ou um aplicativo completo, comece com
[Agent Surfaces](/docs/agent-surfaces).

```an-diagram title="A membrana de incorporação" summary="O aplicativo host fornece autenticação do lado do servidor e contexto de página ativa; Agent-Native executa o sidecar durável e acessa a guia aberta por meio de ações do cliente e comandos do host."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-box\" data-rough><strong>App SaaS host</strong><small class=\"diagram-muted\">sua UI, sua autenticação</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">getContext &rarr;</div><div class=\"diagram-pill\">&larr; ações do cliente</div><div class=\"diagram-pill\">&larr; comandos do host</div></div><div class=\"diagram-panel center\" data-rough><strong>Agent-Native sidecar</strong><small class=\"diagram-muted\">chat durável · estado do app · extensões</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL<br><small class=\"diagram-muted\">tabelas do framework</small></div></div>",
  "css": ".diagram-embed{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-embed .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Comece aqui: o plugin com baterias incluídas {#batteries-included}

Para a maioria dos hosts SaaS, **use o tempo de execução integrado completo** — o plug-in do servidor
`createAgentNativeEmbeddedPlugin` mais o cliente `<AgentNativeEmbedded>`
componente. Este é o padrão recomendado: reutiliza todo o framework
(actions, estado do aplicativo compatível com SQL, extensões, ferramentas de sessão do navegador) e fornece o
agente a capacidade de ver e operar na página que o usuário já está usando.

O host monta rotas do servidor Agent-Native em seu aplicativo existente e passa seu
usuário logado em Agent-Native e renderiza a barra lateral React no produto UI.
Agent-Native usa a implantação do host, a sessão do host e o configurado
`DATABASE_URL` para gerenciar suas próprias tabelas de estrutura: tópicos de bate-papo, configurações,
estado do aplicativo, extensões, dados de extensão, segredos, sessões do navegador e
rotas de ação.

```bash
pnpm add @agent-native/core
```

No servidor:

```ts
// server/plugins/agent-native.ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";
import { builderActions } from "../agent-native/actions";
import { getBuilderSession } from "../auth";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.DATABASE_URL,
  auth: async (event) => {
    const session = await getBuilderSession(event);
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      orgId: session.organization.id,
      orgRole: session.organization.role,
    };
  },
  actions: builderActions,
  agentChat: {
    appId: "builder",
    systemPrompt:
      "You are Builder's embedded agent. Use Builder actions for durable work.",
  },
});
```

No cliente:

```tsx
import {
  AgentNativeEmbedded,
  defineClientAction,
} from "@agent-native/core/client";

export function BuilderAppShell({ children, content, editor }) {
  return (
    <AgentNativeEmbedded
      defaultOpen
      session={{
        id: browserTabId(),
        label: "Builder editor",
      }}
      getContext={() => ({
        route: {
          name: "builder-editor",
          pathname: window.location.pathname,
          params: { contentId: content.id },
        },
        resource: {
          type: "content",
          id: content.id,
          name: content.name,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction({
          name: "select-element",
          description: "Select an element in the visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onRefresh={() => queryClient.invalidateQueries()}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRemount={() => setAppKey((key) => key + 1)}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

Este modo é o padrão recomendado porque reutiliza a estrutura completa: o back-end actions é montado em `/_agent-native/actions`, o agente pode chamar o mesmo actions que o UI, as extensões criadas pelo usuário são armazenadas em SQL, o `extensionData` é durável e tem escopo de usuário/org, e as ferramentas de sessão do navegador permitem que o agente de back-end inspecione ou opere o atualmente aberto guia.

A autenticação do host é do lado do servidor. Não passe a identidade do navegador como fonte da verdade; use o objeto de solicitação/sessão do host ou um token verificado pelo servidor de curta duração. Se o host não expor e-mails, retorne um `userId` estável e Agent-Native o usará como chave do proprietário.

### Isolamento de banco de dados

O modo incorporado gerencia tabelas Agent-Native em SQL. Para um produto SaaS maduro, o padrão mais seguro é **mesma hospedagem e autenticação, banco de dados/esquema Agent-Native dedicado**:

```ts
export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

O uso do `DATABASE_URL` principal do produto host é suportado, mas faça disso uma escolha explícita. Agent-Native cria tabelas de estrutura como `settings`, `application_state`, `tools`, `tool_data`, tabelas de sessão do navegador, segredos, threads de bate-papo e índices relacionados. Um banco de dados/esquema dedicado evita colisões de nomes de tabelas, mantém clara a propriedade das tabelas gerenciadas e torna a política de backup/retenção mais fácil de raciocinar. Se você compartilhar intencionalmente o banco de dados host, revise primeiro os nomes das tabelas existentes e trate as tabelas Agent-Native como pertencentes à estrutura.

## Outros modos {#other-modes}

O plugin com baterias incluídas acima é o caminho certo. Procure um desses
somente quando for melhor para sua situação:

| Modo                                    | Use quando                                                                                                                                | Pacote                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Seletor de aplicativos incorporados** | Lançamento de um aplicativo Agent-Native completo como um iframe focado (seletor de ativos, criador de formulários, painel de aprovação). | `@agent-native/embedding`                    |
| **ponte de host `<AgentNative>`**       | Aplicativos secundários independentes ou iframes de origem cruzada que conectam o contexto da página e o cliente actions manualmente.     | `@agent-native/core/client`                  |
| **Extensões portáteis**                 | Permitir que usuários host criem miniaplicativos em sandbox quando o SaaS já possui armazenamento/aprovação de extensão.                  | Slot de extensão `@agent-native/core/client` |

O pacote `@agent-native/embedding` de nível inferior expõe:

| Caminho de importação              | O que ele oferece                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `@agent-native/embedding`          | Componente seletor `EmbeddedApp`, `getA2AUrl`, `getMcpUrl`, `sendMessage` (streaming A2A)     |
| `@agent-native/embedding/react`    | Ganchos e componentes específicos de React                                                    |
| `@agent-native/embedding/bridge`   | `announceEmbeddedAppReady`, `sendEmbeddedAppMessage` — usado dentro do aplicativo incorporado |
| `@agent-native/embedding/agent`    | Ajudantes de endpoint do agente                                                               |
| `@agent-native/embedding/protocol` | Tipos de protocolo                                                                            |

```bash
pnpm add @agent-native/embedding
```

### Aplicativo incorporado e modo seletor

Use `@agent-native/embedding` quando o produto host quiser lançar um
Aplicativo Agent-Native como uma superfície iframe focada: um seletor de ativos, gerador de ativos,
criador de formulários, seletor de espaço de calendário, painel de aprovação ou qualquer outra tarefa específica
fluxo de trabalho. Isto é intencionalmente menor que a ponte host sidecar abaixo: o
iframe anuncia prontidão, o host pode enviar mensagens nomeadas e as incorporadas
o aplicativo pode emitir eventos de domínio como `chooseAsset` ou `close`.

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

export function AssetPickerDialog({ close }) {
  return (
    <EmbeddedApp
      url="https://assets.agent-native.com/picker"
      className="h-full w-full"
      onLoad={(ref) => {
        ref.postMessage("configure", {
          prompt: "Editorial blog hero",
          aspectRatio: "16:9",
        });
      }}
      onMessage={(name, payload) => {
        if (name === "chooseAsset") {
          const asset = payload as { url: string; altText?: string };
          insertAsset(asset.url, asset.altText);
          close();
        }
        if (name === "close") close();
      }}
    />
  );
}
```

Dentro do aplicativo incorporado, use a ponte do navegador para anunciar a disponibilidade e enviar
eventos de volta ao host:

```ts
import {
  announceEmbeddedAppReady,
  sendEmbeddedAppMessage,
} from "@agent-native/embedding/bridge";

announceEmbeddedAppReady({ app: "assets", mode: "picker" });
sendEmbeddedAppMessage("chooseAsset", {
  url: asset.previewUrl,
  assetId: asset.id,
  altText: asset.altText,
});
```

Os ativos também emitem `chooseImage` como um alias de compatibilidade para seletores de imagens mais antigos
anfitriões; novas integrações devem escutar `chooseAsset`.

Para aplicativos próprios hospedados, ative Cross-App SSO com Dispatch como identidade
hub para que `content.agent-native.com` e `assets.agent-native.com` vinculem usuários por
e-mail verificado. Os lançamentos de iframe ainda devem usar escopo de rota e de curta duração
incorporar sessões quando precisarem de resiliência a cookies de terceiros; cookies normais de aplicativos
não são uma história de autenticação incorporada completa por si só.

O mesmo pacote inclui auxiliares de endpoint do agente para descoberta de protocolo e
streaming de texto por A2A:

```ts
import { getA2AUrl, getMcpUrl, sendMessage } from "@agent-native/embedding";

getMcpUrl("https://assets.agent-native.com");
getA2AUrl("https://assets.agent-native.com");

for await (const chunk of sendMessage(
  "https://assets.agent-native.com",
  "Generate a blog hero",
)) {
  append(chunk);
}
```

### Aplicativo host (ponte de host `<AgentNative>`)

> O plugin acima incluído com baterias é o preferido. Use esta ponte de nível inferior
> apenas para aplicativos secundários independentes ou iframes de origem cruzada onde você conecta a página
> contexto e cliente actions você mesmo.

Para aplicativos secundários independentes ou iframes de origem cruzada, use o `<AgentNative />` de nível inferior. Ele renderiza o sidecar iframe e o contexto da página de fios, o cliente ativo actions e os comandos de atualização/navegação do host em um só lugar:

```tsx
import { AgentNative, defineClientAction } from "@agent-native/core/client";

export function AssistantDock({ customer, sessionToken }) {
  return (
    <AgentNative
      agentUrl="https://agent.example.com/workspaces/acme/sidecar"
      className="h-full w-full"
      session={{ id: browserTabId(), label: "Customer detail" }}
      auth={() => ({ token: sessionToken })}
      screen={{ includeVisibleText: true }}
      getContext={() => ({
        route: {
          name: "customer-detail",
          pathname: window.location.pathname,
          params: { customerId: customer.id },
        },
        resource: {
          type: "customer",
          id: customer.id,
          name: customer.name,
        },
        selection: {
          ids: getSelectedRowIds(),
          text: window.getSelection()?.toString() || undefined,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction<{ contentId: string }, { published: true }>({
          name: "publish-content",
          description: "Publish a Builder content entry",
          schema: {
            type: "object",
            properties: { contentId: { type: "string" } },
            required: ["contentId"],
          },
          destructive: true,
          approval: { title: "Publish this entry?", risk: "medium" },
          run: async ({ contentId }, { refresh }) => {
            await builderApi.publish(contentId);
            await refresh({ queryKey: ["content", contentId] });
            return { published: true };
          },
        }),
        defineClientAction<{ elementId: string }, void>({
          name: "select-element",
          description: "Select an element in the live visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onNavigate={(payload) => {
        const { path } = payload as { path: string };
        router.navigate(path);
      }}
      onRefresh={(payload) => {
        const { queryKey } = payload as { queryKey?: readonly unknown[] };
        queryClient.invalidateQueries({ queryKey });
      }}
      onRemount={() => setAppKey((key) => key + 1)}
      onOpenResource={(payload) => openResource(payload)}
      onRequestApproval={(payload) => approvalDialog.confirm(payload)}
    />
  );
}
```

Use `screen={false}` se desejar apenas um contexto semântico explícito. Use `screen={{ includeDomHtml: true }}` como substituto para aplicativos que ainda não mapearam seu UI em IDs semânticos e estado de seleção. A ponte host aceita apenas mensagens da origem do `agentUrl` por padrão. Passe `agentOrigin` se o iframe URL for um URL roteado/proximado cuja origem confiável seja diferente.

Para hosts não React, chame `createAgentNativeHostBridge()` diretamente e passe as mesmas opções `getContext`, `actions` e `commands`.

### Lado do iframe

Dentro do arquivo secundário Agent-Native, use os auxiliares de quadro para solicitar o contexto do host, descobrir a sessão do navegador ao vivo actions, executá-los ou pedir ao host para fazer o trabalho do UI. Sempre passe o `hostOrigin` esperado em produção:

```ts
import {
  announceAgentNativeFrameReady,
  createAgentNativeHostTools,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
} from "@agent-native/core/client";

announceAgentNativeFrameReady({ hostOrigin: "https://app.example.com" });

const context = await requestAgentNativeHostContext({
  hostOrigin: "https://app.example.com",
});

const liveActions = await requestAgentNativeHostActions({
  hostOrigin: "https://app.example.com",
});

await runAgentNativeHostAction(
  "select-element",
  { elementId: context.selection?.ids?.[0] },
  { hostOrigin: "https://app.example.com" },
);

await sendAgentNativeHostCommand(
  "refreshData",
  { queryKey: ["customer", context.resource?.id] },
  { hostOrigin: "https://app.example.com" },
);

const hostTools = createAgentNativeHostTools({
  hostOrigin: "https://app.example.com",
});
```

### Ponte de ferramentas mediada por servidor

Para um colega de trabalho no estilo CLAW, o iframe também pode registrar sua guia ativa do navegador com o backend sidecar. O agente então obtém ferramentas de back-end normais que enfileiram uma solicitação, o iframe a reivindica, a página host a executa e o back-end retorna o resultado ao agente.

```an-diagram title="Ponte de sessão de navegador mediada por servidor" summary="Uma ferramenta de back-end enfileira o trabalho; a aba registrada reivindica-o, executa-o na página ativa e o resultado retorna ao agente - então um agente backend/Slack/A2A ainda pode tocar na aba aberta."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-node\" data-rough>Agente backend<br><small class=\"diagram-muted\">conversa · Slack · A2A</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>enqueue request<br><small class=\"diagram-muted\">/_agent-native/browser-sessions</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>A aba ativa assume<br><small class=\"diagram-muted\">registered bridge</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">result &rarr; agent</div></div>",
  "css": ".diagram-bridge{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}"
}
```

No aplicativo sidecar, inicie a ponte de sessão do navegador uma vez quando o iframe for montado:

```tsx
import { useEffect } from "react";
import { startAgentNativeBrowserSessionBridge } from "@agent-native/core/client";

export function SidecarRuntime() {
  useEffect(() => {
    const bridge = startAgentNativeBrowserSessionBridge({
      hostOrigin: "https://app.example.com",
      label: "Builder editor",
    });
    return () => bridge.stop();
  }, []);

  return null;
}
```

A estrutura monta `/_agent-native/browser-sessions` automaticamente. Quando a ponte estiver em execução, o agente secundário poderá usar:

| Ferramenta                     | Propósito                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `list-browser-sessions`        | Veja as guias de host conectado do usuário atual.                             |
| `view-browser-session`         | Solicite a uma guia ativa o contexto da página atual e o instantâneo da tela. |
| `list-browser-session-actions` | Solicite em uma guia ativa os manifestos de ação atuais do lado do cliente.   |
| `run-browser-session-action`   | Execute uma ação atual do cliente na guia Ao vivo.                            |
| `send-browser-session-command` | Peça ao anfitrião para atualizar, navegar, remontar, recarregar ou aprovar.   |

Esta é a ponte a ser usada quando o agente está sendo executado no backend, em Slack/Telegram/email, ou como um receptor A2A, mas ainda precisa tocar na guia atual do navegador do usuário quando ela está aberta. Se o navegador estiver fechado, o backend actions ainda deverá lidar com o trabalho durável e as ferramentas de sessão do navegador reportarão que nenhuma guia ativa está conectada.

### Actions

Existem duas classes de ação:

| Tipo de ação     | Onde é executado                                                    | Funciona quando o navegador está fechado? | Melhor para                                                                                                                  |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ação de back-end | Aplicativo sidecar, backend API, MCP ou adaptador de integração     | Sim                                       | Trabalho durável como criar, atualizar, publicar, sincronizar, enviar, importar.                                             |
| Ação do cliente  | Guia atual do navegador por meio de `<AgentNative actions={...} />` | Não                                       | UI efêmero funciona como selecionar um elemento, ler o estado do editor, rolar até uma linha, copiar o estado atual da tela. |

Backend actions deve ser o padrão para qualquer coisa que deva sobreviver a atualizações, navegadores fechados, novas tentativas ou execuções acionadas por integração. Eles pertencem à camada normal de ação/ferramenta Agent-Native do aplicativo secundário, onde o agente pode chamá-los por chat, automações, integrações Slack/Telegrama/e-mail e trabalhos em segundo plano.

O cliente actions é uma ponte ativa para uma guia do navegador. O host os anuncia com `source: "client"` e `availability: "browser-session"`, e o sidecar deve tratar esse manifesto como temporário. Liste novamente actions quando a rota ou seleção for alterada e retorne ao back-end actions quando a guia desaparecer.

### Extensões Portáteis

> Prefira o plugin com baterias incluídas quando quiser que o Agent-Native gerencie
> definições de extensão, aprovação, armazenamento e extensões criadas por agentes. Usar
> o slot portátil abaixo somente quando o SaaS já possui essas preocupações.

O SDK também oferece suporte a extensões definidas pelo usuário: miniaplicativos Alpine.js em sandbox que um host SaaS pode renderizar em slots nomeados. Use isso quando o cliente quiser criar seus próprios pequenos painéis, calculadoras, dashboards ou auxiliares de fluxo de trabalho na mesma superfície de ação/contexto que o agente usa.

```tsx
import {
  AgentNativeExtensionSlot,
  createHttpAgentNativeExtensionStorage,
  defineClientAction,
} from "@agent-native/core/client";

const storage = createHttpAgentNativeExtensionStorage({
  endpoint: "/api/agent-native/extensions/storage",
  headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
});

const actions = [
  defineClientAction({
    name: "list-at-risk-customers",
    description: "List customers currently at risk",
    schema: { type: "object", properties: {} },
    run: () => crmApi.customers.list({ status: "at-risk" }),
  }),
];

const customerHealthExtension = {
  id: "customer-health",
  name: "Customer health",
  description: "Shows at-risk customers and quick notes.",
  manifest: {
    slots: ["crm.customer.sidebar"],
    requestedActions: ["list-at-risk-customers"],
    requestedCommands: ["openResource", "refreshData"],
    storageScopes: ["user", "org"],
  },
  content: `
    <div x-data="{
      customers: [],
      note: '',
      async init() {
        this.customers = await appAction('list-at-risk-customers', {})
        const row = await extensionData.get('notes', slotContext.customerId, { scope: 'user' })
        this.note = row?.data?.text || ''
      },
      async save() {
        await extensionData.set('notes', slotContext.customerId, { text: this.note }, { scope: 'user' })
        await agentNative.refresh({ customerId: slotContext.customerId })
      }
    }" x-init="init()" class="space-y-3">
      <textarea class="w-full rounded-md border bg-background p-2" x-model="note"></textarea>
      <button class="rounded-md bg-primary px-3 py-2 text-primary-foreground" @click="save()">Save</button>
    </div>
  `,
};

export function CustomerSidebar({ customer, userExtensions }) {
  return (
    <AgentNativeExtensionSlot
      id="crm.customer.sidebar"
      extensions={[customerHealthExtension, ...userExtensions]}
      context={{ customerId: customer.id, plan: customer.plan }}
      actions={actions}
      storage={storage}
      storageContext={{
        userId: currentUser().id,
        organizationId: currentOrganization().id,
      }}
      getContext={() => ({
        resource: { type: "customer", id: customer.id, name: customer.name },
      })}
      commands={{
        refreshData: async () => queryClient.invalidateQueries(),
      }}
    />
  );
}
```

O manifesto é o contrato de instalação. Quando `requestedActions`, `requestedCommands` ou `storageScopes` estão presentes, o SDK os impõe no host antes que uma solicitação de iframe alcance a ponte de ação ou o adaptador de armazenamento. Quando `slots` está presente, `AgentNativeExtensionSlot` renderiza apenas a extensão em slots correspondentes. Os hosts ainda podem substituir a política por slot com `allowedActions`, `allowedCommands` e `allowedStorageScopes`.

Uma extensão é HTML simples. O tempo de execução do iframe fornece as mesmas primitivas de ponte seguras para o miniaplicativo:

```html
<div
  x-data="{ customers: [], async init() { this.customers = await appAction('list-at-risk-customers', {}) } }"
  x-init="init()"
>
  <template x-for="customer in customers" :key="customer.id">
    <button
      class="block w-full rounded-md px-3 py-2 text-left hover:bg-muted"
      x-text="customer.name"
      @click="agentNative.command('openResource', { type: 'customer', id: customer.id })"
    ></button>
  </template>
</div>
```

Globais disponíveis dentro do iframe:

| Ajudante                       | Propósito                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `appAction(name, args)`        | Execute uma ação declarada pelo host.                            |
| `agentNative.context()`        | Leia a página do host atual, recursos, slots e dados do usuário. |
| `agentNative.command(name, p)` | Peça ao host para navegar, atualizar, remontar ou abrir.         |
| `agentNative.refresh(payload)` | Atalho para `refreshData`.                                       |
| `extensionData.*`              | Persistir dados de extensão local por meio do adaptador host.    |

Por padrão, `extensionData` usa o navegador `localStorage`, que é útil para protótipos e widgets locais. Os hosts SaaS de produção devem passar um adaptador `storage` apoiado por back-end para que os dados de extensão com escopo do usuário e da organização sejam duráveis, auditáveis ​​e controlados pelas permissões do aplicativo. O adaptador HTTP genérico envia corpos POST como `{ operation, extensionId, slotId, collection, id, data, options, context }` e espera `{ result }` ou o resultado JSON diretamente.

Esta camada SDK portátil é separada do armazenamento de extensão integrado com suporte de SQL da estrutura. Em um aplicativo Agent-Native, use os componentes `ExtensionSlot`/`EmbeddedExtension` existentes e a ação `create-extension`. Em um cenário de incorporação de SaaS hospedado, prefira `createAgentNativeEmbeddedPlugin()` mais `AgentNativeEmbedded` quando desejar que Agent-Native gerencie definições de extensão, aprovação, armazenamento e extensões criadas por agente imediatamente. Use `AgentNativeExtensionSlot` somente quando o SaaS já possuir definições de extensão, aprovação, mercado, armazenamento e cobrança.

Modelo de segurança:

- Os iframes de extensão são colocados em sandbox sem `allow-same-origin`; o miniaplicativo não pode ler o DOM pai, os cookies ou o tempo de execução do aplicativo diretamente.
- As extensões só podem chamar actions e comandos permitidos pelo host e pelo manifesto da extensão.
- actions arriscado deve definir `destructive` ou `requiresApproval` para que o host possa mostrar um fluxo de aprovação.
- Trate a extensão HTML de autoria do usuário como não confiável. Revise as instalações do Marketplace, o uso de ações de registro e o escopo do armazenamento de back-end por usuário/organização.

### Sessões e guias

A ponte de host tem como escopo um par iframe/host-janela. Se o mesmo usuário abrir diversas guias, cada guia terá seu próprio `session`, contexto, seleção, cliente actions e respostas de comando pendentes. Não presuma que uma ação do cliente descoberta em uma guia poderá ser executada em outra guia ou que ainda existirá após a navegação.

Para produtos com várias guias, mantenha o estado durável em SQL/backend actions e use o cliente actions apenas para as partes locais da guia: focar uma linha, copiar o estado visível do editor, selecionar um elemento de tela ou atualizar o cache de consulta React atual. Inclua contextos `route`, `resource` e `selection` suficientes para que o arquivo secundário decida se a guia atual é o lugar certo para executar uma ação de sessão do navegador.

### Modelo de Comando

Os nomes dos comandos integrados são deliberadamente em formato de aplicativo, não de banco de dados:

| Comando                                | Propósito                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `navigate`                             | Mova o host UI para um caminho/visualização/recurso.                                       |
| `refreshData` / `refresh-data`         | Peça ao host para invalidar os dados do lado do cliente.                                   |
| `remountView` / `remount-view`         | Peça ao host para remontar uma subárvore, por exemplo. `<App key={key} />`.                |
| `hardReload` / `hard-reload`           | Recarga completa do navegador.                                                             |
| `openResource` / `open-resource`       | Abra um objeto de domínio específico no host UI.                                           |
| `requestApproval` / `request-approval` | Peça ao anfitrião para mostrar um fluxo de confirmação. Registre um manipulador para isso. |

Se nenhum manipulador for fornecido, os padrões seguros despacham eventos do navegador como `agentNative:refresh-data` e `agentNative:remount-view`. `requestApproval` não possui manipulador padrão; registre um antes de confiar nele.

### Orientações para aprovação

Marque o cliente de risco actions com `destructive: true` em seu manifesto e exija a aprovação do host antes de executar operações que excluam, publiquem, enviem, cobrem, convidem, compartilhem ou de outra forma afetem usuários fora da visualização atual. O backend actions também deve aplicar suas próprias verificações de autorização e aprovação; a aprovação do host é uma experiência de usuário útil, não o limite de segurança.

Prefira esta forma:

- A mutação durável é executada em uma ação de back-end com validação, autenticação, registro de auditoria e novas tentativas.
- O comando Host abre uma aprovação UI ou concentra o recurso afetado.
- A ação do cliente lida apenas com a etapa UI ativa que não pode acontecer no back-end.

### Integração de tempo de execução

Use `createAgentNativeHostTools()` dentro do iframe secundário quando o tempo de execução do agente aceitar descritores de ferramenta simples. Ele retorna quatro ferramentas independentes de estrutura:

| Ferramenta          | Propósito                                                             |
| ------------------- | --------------------------------------------------------------------- |
| `view-host-screen`  | Leia o contexto semântico do host e o instantâneo da tela.            |
| `list-host-actions` | Liste a sessão ao vivo do navegador actions exposta pela guia atual.  |
| `run-host-action`   | Execute uma ação de cliente ativa por nome.                           |
| `send-host-command` | Envie comandos de host, como atualizar, navegar, remontar ou aprovar. |

O auxiliar retorna intencionalmente objetos `{ name, description, parameters, execute }` simples para que os sidecars possam adaptá-los à chamada de função AI SDK, Anthropic, OpenAI ou forma Agent-Native `ActionEntry` sem acoplar este SDK a um tempo de execução.

## Formato de produto recomendado

Inicie o iframe primeiro. Ele funciona para Builder.io, aplicativos SaaS do cliente e ferramentas de administração interna sem acoplamento de ciclos de lançamento ou suposições de CSS/tempo de execução.

O sidecar em si ainda deve ser um aplicativo/modelo Agent-Native: actions é a superfície de backend API, o estado do aplicativo apoiado por SQL é a memória do agente e integrações como Slack ou Telegram podem ser roteadas para o mesmo chat durável. A incorporação SDK fornece a membrana ativa entre esse arquivo secundário e a página host atual.
