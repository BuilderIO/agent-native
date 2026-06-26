---
title: "Roteamento"
description: "Roteamento baseado em arquivo para aplicativos nativos de agente com React Router v8 — páginas, parâmetros dinâmicos e navegação."
---

# Roteamento

Os aplicativos nativos do agente usam o **React Router v8** com roteamento baseado em arquivo via `flatRoutes()` de `@react-router/fs-routes`. Cada arquivo em `app/routes/` se torna um URL. Os modelos usam a convenção de notação de ponto: os pontos separam os segmentos URL dentro de um único nome de arquivo.

## Roteamento baseado em arquivo {#file-based-routing}

### Arquivo → Mapeamento URL

| Arquivo               | URL                | Notas                                        |
| --------------------- | ------------------ | -------------------------------------------- |
| `_index.tsx`          | `/`                | Rota de índice                               |
| `settings.tsx`        | `/settings`        | Página simples                               |
| `inbox.$threadId.tsx` | `/inbox/:threadId` | Ponto = `/`, `$` = parâmetro dinâmico        |
| `_app.tsx`            | (sem segmento URL) | Layout sem caminho — prefixo com `_`         |
| `inbox/route.tsx`     | `/inbox`           | Formulário de pasta — `route.tsx` é o índice |

Prefixe um segmento com `$` para um parâmetro dinâmico. Prefixe com `_` para torná-la uma rota de layout sem caminho (sem segmento URL). Os modelos usam `flatRoutes()` — o arquivo de notação de ponto acima é o principal; o formato de pasta aninhada `inbox/route.tsx` também funciona.

```an-diagram title="Layout sem caminho envolve as páginas" summary="Um layout _app.tsx (sem segmento URL) renderiza o shell compartilhado uma vez; as páginas correspondentes são renderizadas dentro de seu <Outlet/>, para que a barra lateral do agente nunca seja remontada na navegação."
{
"html": "<div class=\"diagram-layout\" data-rough><div class=\"diagram-shell\"><span class=\"diagram-pill accent\">_app.tsx</span><small class=\"diagram-muted\">layout sem rota · shell persistente + barra do agente</small><div class=\"diagram-outlet\" data-rough><small class=\"diagram-muted\">&lt;Outlet/&gt; — the matched page</small><div class=\"diagram-row\"><span class=\"diagram-pill\">_index.tsx &rarr; /</span><span class=\"diagram-pill\">settings.tsx &rarr; /settings</span><span class=\"diagram-pill\">inbox.$threadId.tsx &rarr; /inbox/:threadId</span></div></div></div></div>",
"css": ".diagram-layout .diagram-shell{display:flex;flex-direction:column;gap:8px;padding:16px}.diagram-layout .diagram-outlet{display:flex;flex-direction:column;gap:8px;padding:14px;margin-top:6px}.diagram-layout .diagram-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}"
}

```

## Adicionando uma nova página {#adding-a-page}

Crie o arquivo e exporte um componente padrão:

```tsx
// app/routes/settings.tsx
export function meta() {
  return [{ title: "Settings" }];
}

export default function SettingsPage() {
  return <div>Settings</div>;
}
```

É isso aí - o roteador React coleta automaticamente, sem necessidade de registro.

## Parâmetros dinâmicos {#dynamic-params}

```tsx
// app/routes/inbox/$threadId.tsx
import { useParams } from "react-router";

export default function ThreadPage() {
  const { threadId } = useParams();
  return <div>Thread: {threadId}</div>;
}
```

## Navegação {#navigation}

Use `<Link>` para navegação no lado do cliente e `useNavigate()` para navegação programática:

```tsx
import { Link, useNavigate } from "react-router";

// In JSX
<Link to="/settings">Settings</Link>;

// Programmatic
const navigate = useNavigate();
navigate(`/inbox/${threadId}`);
```

## O que vem a seguir

- [**Client**](/docs/client) — os ganchos e utilitários do navegador nativos do agente
- [**Server**](/docs/server) — rotas de servidor baseadas em arquivo e o namespace `/_agent-native/`
