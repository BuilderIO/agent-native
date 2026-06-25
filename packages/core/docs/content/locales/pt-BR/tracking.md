---
title: "Acompanhamento e análise"
description: "Análise do lado do servidor com provedores conectáveis — PostHog, Mixpanel, Amplitude ou webhook personalizado"
---

# Acompanhamento do Google Analytics

Uma função, vários destinos. Chame `track()` a partir de qualquer código do lado do servidor – actions, plug-ins, rotas de servidor – e o evento se espalhará para todos os provedores de análise registrados. Sem dependências SDK, sem scripts do lado do cliente, sem bloqueio. O mesmo `track()` também está disponível em [browser/app code](#client) e é roteado para os mesmos provedores.

Esta é a análise de _produto_ - os eventos do seu aplicativo fluindo para PostHog/Mixpanel/Amplitude. Para métricas de _qualidade do agente_ (rastreamentos, custos, avaliações, feedback) armazenadas em seu próprio banco de dados, consulte [Observability](/docs/observability).

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

```an-diagram title="Uma chamada track(), cada provedor" summary="Os chamadores de servidores e clientes acessam o mesmo registro, que espalha cada evento para todos os provedores ativos em paralelo."
{
  "html": "<div class=\"trk\"><div class=\"diagram-col\"><div class=\"diagram-node\">Código do servidor<br><small class=\"diagram-muted\">actions &middot; plugins &middot; routes</small></div><div class=\"diagram-node\">Código do navegador<br><small class=\"diagram-muted\">POST /_agent-native/track</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Provider registry</span><small class=\"diagram-muted\">fan-out, disparar e esquecer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">PostHog</div><div class=\"diagram-box\">Mixpanel</div><div class=\"diagram-box\">Amplitude</div><div class=\"diagram-box\">Webhook</div></div></div>",
  "css": ".trk{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.trk .diagram-col{display:flex;flex-direction:column;gap:8px}.trk .diagram-arrow{font-size:22px;line-height:1}.trk .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Provedores integrados {#built-in}

Defina um env var e o provedor será registrado automaticamente na inicialização do servidor. Não são necessárias alterações de código.

| Provedor          | Vars ambientes                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| PostHog           | `POSTHOG_API_KEY` (obrigatório), `POSTHOG_HOST` (opcional, o padrão é `https://us.i.posthog.com`)  |
| Painel de mixagem | `MIXPANEL_TOKEN`                                                                                   |
| Amplitude         | `AMPLITUDE_API_KEY`                                                                                |
| Webhook           | `TRACKING_WEBHOOK_URL` (obrigatório), `TRACKING_WEBHOOK_AUTH` (cabeçalho `Authorization` opcional) |

Vários provedores podem estar ativos simultaneamente. Cada evento vai para todos eles.

## API {#api}

### `track(name, properties?, meta?)` {#track}

Dispare um evento de análise. Distribua para todos os fornecedores registrados.

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

Identifique um usuário com características. Encaminhado para provedores que o suportam (PostHog, Mixpanel, Amplitude, webhook).

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

Precisa de um back-end personalizado, o registro do provedor API ou os componentes internos de lote/singleton? Veja [Advanced: custom providers & internals](#advanced) no final.

## Usando track() em modelos {#templates}

Chame `track()` de manipuladores de ação para registrar a atividade do usuário ou do agente:

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

export default defineAction({
  description: "Create a new project.",
  schema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  run: async ({ name, template }, ctx) => {
    const project = await db
      .insert(projects)
      .values({ name, template })
      .returning();

    track("project.created", { name, template }, { userId: ctx.userEmail });

    return { ok: true, projectId: project[0].id };
  },
});
```

As chamadas de rastreamento são do tipo "dispare e esqueça" — elas retornam imediatamente e nunca bloqueiam a resposta da ação.

## Acompanhamento do lado do cliente {#client}

`track()` também funciona a partir do código do navegador/aplicativo. Importe o cliente gêmeo de `@agent-native/core/client` e chame-o da mesma maneira - ele envia o evento para a rota da estrutura em `POST /_agent-native/track`, que o encaminha para os **mesmos** provedores registrados do lado do servidor (PostHog, Mixpanel, Amplitude, webhook). Nenhuma análise do SDK é enviada para o navegador e nenhuma chave do provedor é exposta no lado do cliente.

```an-api title="A rota de rastreamento do cliente"
{
  "method": "POST",
  "path": "/_agent-native/track",
  "summary": "Encaminhar um evento do navegador para os provedores registrados do lado do servidor",
  "auth": "Session required + same-origin/CSRF marker (set automatically by the client helper). Not an open analytics relay.",
  "params": [
    { "name": "name", "in": "body", "type": "string", "required": true, "description": "Event name. Capped at 200 characters." },
    { "name": "properties", "in": "body", "type": "object", "description": "Event properties (~16KB cap). `source: \"client\"` and the active `org_id` are added server-side." }
  ],
  "description": "Identity is resolved **server-side** from the session — browser code never passes a `userId`. Fire-and-forget: never blocks the UI, never throws, swallows network errors. Oversized or malformed payloads are rejected."
}
```

```ts
import { track } from "@agent-native/core/client";

// e.g. inside a click handler or effect
track("checkout.completed", { total: 49.99, items: 3 });
```

Principais diferenças em relação ao [server `track()`](#track):

- **Nenhum argumento de identidade.** O evento é atribuído no lado do servidor ao usuário conectado (e à organização ativa, como `org_id` em `properties`). O código do navegador nunca passa por `userId`.
- **`source: "client"`** é adicionado às propriedades de cada evento para que você possa diferenciar os eventos originados do cliente dos do servidor.
- **Dispare e esqueça.** Ele nunca bloqueia o UI, nunca lança e engole erros de rede.
- **Autenticado, somente primário.** A rota requer uma sessão e um marcador de mesma origem/CSRF (definido automaticamente pelo auxiliar), portanto, não pode ser usada como uma retransmissão de análise aberta. `name` tem um limite de 200 caracteres e `properties` de aproximadamente 16 KB; cargas superdimensionadas ou malformadas são rejeitadas.

Isso é diferente da telemetria interna do navegador da estrutura (`trackEvent()`/visualizações automáticas de página — veja [Browser defaults](#browser-defaults) abaixo), que alimenta a análise de produto do próprio Agent Native. Use `track()` para os eventos de análise do seu aplicativo que devem chegar aos provedores configurados.

## Avançado: provedores personalizados e internos {#advanced}

A maioria dos aplicativos só precisa de `track()`/`identify()` e de um provedor integrado. O resto da superfície – registro de provedores personalizados, a interface `TrackingProvider`, processamento interno de lotes e a telemetria do navegador da própria estrutura – está abaixo.

<details>
<summary><strong>Registro do provedor API, interface, componentes internos e padrões do navegador</strong></summary>

### `registerTrackingProvider(provider)` {#register}

Registre um provedor personalizado para qualquer back-end de análise.

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
    fetch("https://analytics.example.com/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  },
  identify(userId, traits) {
    // Optional — link user identity to future events
  },
  flush() {
    // Optional — called on graceful shutdown
  },
});
```

### `flushTracking()` {#flush}

Limpe todos os provedores. Ligue antes da saída do processo para garantir que os eventos pendentes sejam enviados.

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

Remover um provedor pelo nome. Retorna `true` se o provedor foi encontrado e removido.

### `listTrackingProviders()` {#list}

Retorna os nomes de todos os provedores registrados.

### A interface TrackingProvider {#provider-interface}

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
}

interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
}
```

Somente `name` e `track` são necessários. `identify` e `flush` são opcionais. Implemente-os se seu back-end oferecer suporte à identidade do usuário e entrega em lote.

### Como funciona {#internals}

- **HTTP em lote** — provedores integrados enfileiram eventos e liberam a cada 10 segundos ou quando 50 eventos se acumulam, o que ocorrer primeiro. Isso minimiza as solicitações de saída sem perder dados.
- **Sem dependências de SDK** — todos os provedores integrados usam `fetch()` bruto. Sem PostHog SDK, sem Mixpanel SDK, sem Amplitude SDK. Mantém a estrutura leve.
- **Entrega com melhor esforço** — os erros do provedor são detectados e registrados. Uma falha na integração analítica nunca trava o chamador ou bloqueia o tratamento da solicitação.
- **Singleton global** — o registro usa uma chave `Symbol.for` em `globalThis` para que várias instâncias de gráfico ESM (modo de desenvolvimento Vite + Nitro, links simbólicos) compartilhem um conjunto de provedores.

### Padrões do navegador {#browser-defaults}

Isso cobre a telemetria interna da própria estrutura — principalmente relevante para contribuidores da estrutura e autores de modelos avançados.

As raízes do modelo chamam `configureTracking()` uma vez na inicialização. Os eventos do navegador enviados com `trackEvent()` incluem automaticamente o contexto do aplicativo/modelo mais a conexão LLM atual quando o aplicativo pode resolvê-lo:

- `llm_connection` — rótulo de provedor normalizado, como `builder`, `anthropic`, `openai`, `google` ou `none`
- `llm_engine` — o ID do motor, por exemplo `builder` ou `ai-sdk:openai`
- `llm_model` — o modelo selecionado/padrão quando conhecido
- `llm_connection_source` — `app_secrets`, `settings` ou `env`
- `llm_connection_configured` — se uma conexão LLM está disponível

A estrutura também rastreia `builder connect clicked` de CTAs do Connect Builder, e as rotas de conexão Builder do lado do servidor rastreiam eventos de ciclo de vida iniciados/bem-sucedidos/com falha. `configureTracking()` é chamado automaticamente pelo framework; você não precisa chamá-lo em seu próprio código de modelo.

</details>

## O que vem a seguir

- [**Actions**](/docs/actions) — onde se origina a maioria das chamadas de rastreamento
- [**Server Plugins**](/docs/server) — `registerBuiltinProviders()` é executado no plugin core-routes na inicialização
- [**Secrets**](/docs/security) — gerencie chaves API para provedores de rastreamento
