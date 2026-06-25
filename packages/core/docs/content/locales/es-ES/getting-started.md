---
title: "Cómo empezar"
description: "Cree una aplicación de agente, comprenda las instrucciones skills y actions y luego observe cómo el agente ejecuta su primera acción."
---

# Cómo empezar

Las aplicaciones Agent-Native brindan a un agente de IA y a su UI el mismo actions, datos y
estado. Un agente básico se hace a partir de instrucciones que lo guían, skills que enseñan
comportamiento repetible y actions que le permiten hacer un trabajo real.

**¿Quieres una aplicación completa para empezar?** Clona una de nuestras plantillas enriquecidas:
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) y [many more](/docs/cloneable-saas) —
cada una de ellas es una aplicación con todas las funciones que puedes personalizar.

¿Construir desde cero? La única opción desde el principio es si quieres un UI —
todo lo posterior (escribir instrucciones, agregar skills, definir actions, ejecutar
el agente) es el mismo en ambos sentidos.

```an-file-tree title="Un agente Agent-Native básico"
{
  "entries": [
    { "path": "AGENTS.md", "note": "Instrucciones siempre activas: propósito, reglas, tono y mapa de lo que el agente puede hacer" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "Un playbook reutilizable que el agente carga cuando la tarea coincide" },
    { "path": "actions/summarize-week.ts", "note": "Código tipado que el agente, la UI, CLI, HTTP, MCP, A2A, jobs y webhooks pueden ejecutar" }
  ]
}
```

Esto es cierto ya sea que comiences con un chat UI, un agente sin cabeza o una aplicación completa.
El UI cambia la superficie; instrucciones, skills y actions le dan al agente su
orientación y comportamiento.

## 1. Crea tu aplicación

Necesitarás [Node.js 22+](https://nodejs.org) y [pnpm](https://pnpm.io).

Ejecute `create` sin indicadores y le preguntará cómo desea comenzar (una plantilla completa,
Chat o Headless) antes que nada:

```bash
npx @agent-native/core@latest create my-app
```

O pase una marca para omitir el mensaje:

**¿Quieres un UI?** Comience desde la plantilla de Chat. Obtienes un agente de trabajo más un
Chat personalizable UI, y cada acción que agregas se muestra automáticamente en él:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**¿Solo la primitiva sin cabeza?** Comience sin cabeza: el mismo actions y agente
bucle, sin shell UI:

```bash
npx @agent-native/core@latest create my-agent --headless
```

Luego instálelo desde la carpeta que creó:

```bash
cd my-agent # o my-app si elegiste la plantilla Chat
pnpm install
```

A partir de ahora, los dos son idénticos.

## 2. Añadir una acción

Una acción es una operación que su agente (y su UI) pueden realizar. Ambos andamios
envío con este ejemplo:

```an-annotated-code title="Tu primera action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Saluda desde el agente local.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Descripción de herramienta", "note": "El agente lee `description` para decidir cuándo llamarla como herramienta." },
    { "lines": "6-8", "label": "Contrato tipado", "note": "Un `schema` de zod valida entradas desde cada superficie: agente, UI, HTTP, MCP y A2A." },
    { "lines": "9", "label": "Verbo HTTP", "note": "Expón esta acción como un endpoint HTTP montado automáticamente." },
    { "lines": "10", "label": "Solo lectura", "note": "`readOnly` marca la acción como segura para llamar sin aprobación y cacheable para consultas." },
    { "lines": "11-13", "label": "Una implementación", "note": "El cuerpo de `run` es la única fuente de verdad que ejecutan todas las superficies." }
  ]
}
```

Reemplace `hello` con la primera operación real en su dominio. Lo defines una vez;
todas las superficies lo recogen.

Utilice `AGENTS.md` como guía que debe aplicarse en cada giro. Usa una habilidad cuando
el agente necesita un flujo de trabajo o un procedimiento de dominio reutilizable. Utilice una acción cuando
el agente necesita una forma escrita y comprobable de leer datos, escribir datos, llamar a un API o
realizar una aprobación.

## 3. Ejecútelo

Llame a la acción directamente:

```bash
pnpm action hello --name Steve
```

O pídale al agente que lo llame por usted:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

Si comenzó desde la plantilla de Chat, ejecute la aplicación y use el mismo agente en
navegador: ya puede llamar a cada acción que definas:

```bash
pnpm dev
```

Ahora se puede acceder a esa acción desde el chat UI, CLI, HTTP, MCP, A2A,
trabajos programados y webhooks. Defina una vez y llame desde cualquier lugar.

```an-diagram title="Una acción, cada superficie" summary="Un único archivo defineAction se distribuye a cada consumidor sin cableado adicional."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Interfaz de chat</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Trabajos programados</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## El estado está integrado

Sin cabeza no significa apátrida. Actions, sesiones, estado de la aplicación, subprocesos,
el historial de ejecución y las credenciales se encuentran en SQL. A nivel local es SQLite en
`data/app.db`; en producción se configura `DATABASE_URL`. Ver
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless sigue siendo una aplicación real.** El bucle aplicación-agente persiste sesiones, subprocesos, ejecuciones, configuraciones y credenciales en SQL; no es un mensaje sin estado. Puede agregar una interfaz de usuario más tarde sin tocar sus acciones o estado."
}
```

## Personaliza el UI

Si comenzó desde la plantilla de Chat, el UI es suyo para editarlo. El chat en sí
es una pequeña ruta construida sobre el componente `<AgentChatSurface>`:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`**: la página de chat. Cambiar las sugerencias, vacía
  estado y diseño.
- **`app/root.tsx`**: el shell de la aplicación. Añade tus propias rutas y pantallas alrededor del
  agente.
- Suelte el agente en cualquier pantalla con `<AgentSidebar>`, trabaje manualmente desde un
  botón con `sendToAgentChat()`, o ejecuta una acción directamente con
  `useActionMutation()`.

Consulte [Drop-in Agent](/docs/drop-in-agent) para conocer el conjunto completo de componentes y
[Native Interfaz de chat](/docs/native-chat-ui) para representar los resultados de la acción como tablas,
gráficos y tarjetas mecanografiadas en lugar de texto sin formato.

**¿Empezaste sin cabeza y quieres un UI más tarde?** La plantilla de chat _es_ la rampa de acceso a UI —
su capa `app/` (React Router + Vite) es exactamente lo que el andamio sin cabeza
se va. El movimiento más limpio es comenzar (o reestructurar) desde el Chat
plantilla; su estado `actions/`, agente y SQL se mantienen sin cambios. Ver
[Agent Surfaces](/docs/agent-surfaces) para cada superficie intermedia.

## Estructura del proyecto

```text
my-app/
  actions/         # Acciones que puede llamar el agente
  app/             # Frontend React (solo plantillas UI; se omite en headless)
  server/          # Servidor API Nitro (rutas, plugins)
  AGENTS.md        # Instrucciones permanentes para el agente
  .agents/         # Skills que el agente puede cargar cuando sean relevantes
  data/app.db      # Estado SQLite local cuando DATABASE_URL no está definido
```

## Adónde ir a continuación

- **[Key Concepts](/docs/key-concepts)**: la arquitectura principal: SQL, actions,
  sincronización y reconocimiento del contexto.
- **[Actions](/docs/actions)**: la acción completa API: esquemas, HTTP, autenticación y
  aprobación.
- **[Agent Surfaces](/docs/agent-surfaces)**: sin cabeza, chat, sidecar integrado,
  y aplicación completa.
- **[Drop-in Agent](/docs/drop-in-agent)**: agrega el chat del agente a cualquier aplicación React.
- **[Deployment](/docs/deployment)**: coloca tu aplicación en tu propio dominio.
- **[FAQ](/docs/faq)**: preguntas sobre configuración y productos.
