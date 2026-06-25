---
title: "FAQ"
description: "Preguntas comunes sobre el agente nativo: qué es, para quién es, qué se puede crear y cómo funciona."
---

# FAQ

Preguntas comunes sobre el agente nativo, organizadas desde "Solo estoy mirando" hasta "Estoy conectando la autenticación ahora mismo".

## Conceptos básicos {#general}

### ¿Qué es el agente nativo? {#what-is-agent-native}

Agent-native es un marco para crear aplicaciones en las que el agente de IA y la superficie del producto que lo rodea son socios iguales. Esa superficie puede comenzar como un agente sin cabeza con una acción personalizada, convertirse en un chat enriquecido o convertirse en un UI completo. La invariante es que los agentes y los humanos comparten el mismo actions, base de datos y estado. Consulte [What Is Agent-Native?](/docs/what-is-agent-native) para obtener la explicación completa.

### ¿Para quién es esto? {#who-is-this-for}

El agente nativo es para personas que desean que una aplicación real y un agente de IA trabajen con los mismos datos y actions. Las rutas comunes son:

- **Utilice una aplicación alojada** si desea Correo, Calendario, Formularios, Plan u otra plantilla terminada sin configuración; comience en [template gallery](/templates).
- **Comience con Chat** si desea una aplicación básica con la que los usuarios puedan hablar inmediatamente, luego amplíe con actions y pantallas; comience con [Getting Started](/docs/getting-started) o [Chat](/docs/template-chat).
- **Inicie primitivo primero** si desea una acción y un bucle de agente de aplicación sin cabeza antes de comprometerse con UI; comience con [Getting Started](/docs/getting-started).
- **Bifurque y personalice una plantilla** si desea su propio producto SaaS con autenticación, base de datos, UI y agente actions ya conectados; consulte [Templates](/docs/cloneable-saas).
- **Compile desde cero** si desea las primitivas del marco para un nuevo producto impulsado por agentes, comience con [Getting Started](/docs/getting-started).
- **Conecte otro agente o herramienta de código** si desea que Claude, ChatGPT, Codex, Cursor o GitHub Copilot/VS Code utilice una aplicación nativa del agente; consulte [External Agents](/docs/external-agents) y [Skills Guide](/docs/skills-guide).

### ¿En qué se diferencia esto de agregar IA a una aplicación existente? {#how-is-this-different}

La mayoría de las aplicaciones incorporan IA como una ocurrencia tardía que en realidad no puede _hacer_ cosas en la aplicación. En una aplicación nativa del agente, el agente es un ciudadano de primera clase que comparte el mismo actions, la misma base de datos y el mismo estado que el UI, por lo que puede hacer cualquier cosa que los botones puedan hacer y modificar el propio código de la aplicación. Ver [What Is Agent-Native?](/docs/what-is-agent-native#the-ladder).

```an-diagram title="IA integrada frente a agent-native" summary="Una barra lateral de chat integrada vive en su propio mundo. Un agente agent-native comparte las mismas acciones, base de datos y estado que la interfaz de usuario."
{
  "html": "<div class=\"diagram-vs\"><div class=\"diagram-col\"><span class=\"diagram-pill warn\">IA añadida por encima</span><div class=\"diagram-node\">Barra lateral de chat</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>mundo de IA separado<br><small class=\"diagram-muted\">no puede tocar la app</small></div><div class=\"diagram-box diagram-muted\">App UI &amp; data</div></div><div class=\"diagram-divider\" aria-hidden=\"true\"></div><div class=\"diagram-col\"><span class=\"diagram-pill ok\">Agent-native</span><div class=\"diagram-row2\"><div class=\"diagram-node\">UI</div><div class=\"diagram-node\">Agent</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>shared actions, DB &amp; state</div></div></div>",
  "css": ".diagram-vs{display:flex;align-items:stretch;gap:18px;flex-wrap:wrap}.diagram-vs .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:center;flex:1;min-width:200px}.diagram-vs .diagram-row2{display:flex;gap:8px}.diagram-vs .diagram-arrow{font-size:20px;line-height:1}.diagram-vs .diagram-divider{width:1px;align-self:stretch;background:currentColor;opacity:.15}"
}
```

### ¿Es de código abierto? {#is-this-open-source}

Sí. El marco y todas las plantillas son de código abierto. Puede ejecutar todo localmente, autohospedarse o utilizar la nube de Builder.io para alojamiento administrado, colaboración y funciones de equipo.

### ¿Cuánto cuesta? {#how-much}

El marco en sí es gratuito. Los dos costos que verás en la práctica:

- **Uso de IA.** Traes tu propia clave API (Anthropic, OpenAI, etc.) y pagas directamente al proveedor del modelo. No hacemos ningún margen de beneficio.
- **Alojamiento.** Lo que sea que cobre tu anfitrión. La mayoría de las plantillas funcionan bien en niveles gratuitos (Netlify, Vercel, Cloudflare) para cargas de trabajo pequeñas.

Si prefiere no administrar nada de esto, la versión alojada en `agent-native.com` (operada por Builder.io) incluye inferencia y alojamiento en un plan por puesto.

### ¿Puedo alojar esto yo mismo? {#can-i-self-host}

Sí. Elija cualquier host que ejecute Node (Netlify, Vercel, Cloudflare, AWS, Deno Deploy, su propio servidor) y cualquier base de datos SQL (Postgres, SQLite, Turso, D1). El marco está diseñado para ser portátil. Ver [Deployment](/docs/deployment).

### ¿Qué modelos de IA admite? {#what-models}

Anthropic Claude, OpenAI (familia GPT-5), Google Gemini y cualquier proveedor que hable la forma OpenAI API (incluidos los modelos locales a través de Ollama). Configuras el modelo en la configuración; El cambio es un cambio de configuración, no una reescritura de código. La ruta más probada del marco es Claude, por lo que esa es la recomendación predeterminada.

### ¿Necesito saber AI/ML? {#do-i-need-to-know-ai}

No. No se entrenan modelos, no se ajustan ni se ocupan de incrustaciones. Creas una aplicación web normal y, en la versión alojada, apenas creas nada. El marco maneja la integración del agente: enrutamiento de mensajes, ejecución de actions, estado de sincronización.

### ¿Puedo migrar una aplicación existente a agente nativo? {#can-i-use-existing-code}

Puedes, pero el agente nativo funciona mejor cuando se construye desde cero. La arquitectura (base de datos compartida, sincronización de sondeos, actions, estado de la aplicación) debe estar integrada en todo momento. Partir de una plantilla y personalizarla es el camino recomendado. Piense en ello como el cambio de una computadora de escritorio primero a una computadora móvil primero: _puede_ modernizarse, pero crear contenido nativo es mejor.

## Plantillas y lo que puedes crear {#templates}

### ¿Qué plantillas están disponibles? {#what-templates-are-available}

El marco se entrega con plantillas listas para producción que incluyen [Chat](/docs/template-chat), [Mail](/docs/template-mail), [Calendar](/docs/template-calendar), [Forms](/docs/template-forms), [Plan](/docs/template-plan) (planos visuales y resúmenes de relaciones públicas), [Analytics](/docs/template-analytics), [Dispatch](/docs/template-dispatch) y más. Cada una es una aplicación completa con UI, agente actions, esquema de base de datos e instrucciones de IA listas para usar. Consulte [Templates](/docs/cloneable-saas) para ver el catálogo completo.

### ¿Puedo personalizar plantillas? {#can-i-customize-templates}

Ese es el punto. Bifurca una plantilla y personalízala preguntándole al agente. "Agregar un campo de prioridad a los formularios". "Conéctese a nuestra instancia de Salesforce". "Cambie la combinación de colores para que coincida con nuestra marca". El agente modifica el código y su aplicación evoluciona con el tiempo.

### ¿Puedo crear algo que las plantillas no cubran? {#build-from-scratch}

Sí. Si desea una aplicación de chat básica, ejecute `npx @agent-native/core@latest create my-chat-app --template chat`; obtienes hilos de chat duraderos, actions, autenticación, estado de ejecución respaldado por SQL y espacio para agregar tus propias pantallas. Si desea la aplicación más pequeña de acción primero sin UI, ejecute `npx @agent-native/core@latest create my-agent --headless`. Consulte [Getting Started](/docs/getting-started), [Pure-Agent Apps](/docs/pure-agent-apps) y [Chat](/docs/template-chat).

### ¿Puedo probarlo sin bifurcar una plantilla? {#try-with-a-skill}

Sí: instale una habilidad en un agente de codificación que ya usa con un comando y no requiere andamio. Consulte [Skills Guide](/docs/skills-guide#app-backed-skills) para ver el tutorial.

## Capacidades del agente {#agent-capabilities}

### ¿Puede realmente el agente modificar el propio código de la aplicación? {#can-the-agent-modify-code}

Sí, y es una característica. El agente puede editar de forma segura componentes, rutas, estilos y actions. Usted pregunta "agregar un gráfico de análisis de cohorte" y el agente lo crea. Pides "conectar a nuestra cuenta Stripe" y el agente escribe la integración. Todo es código normal rastreado por Git, por lo que los cambios incorrectos son fáciles de revertir.

### ¿Pueden los usuarios hablar con el agente desde fuera de la aplicación? {#external-channels}

Sí. El mismo agente se ejecuta en tu web UI, en Slack, en Telegram, por correo electrónico y desde otros agentes (vía [A2A](/docs/a2a-protocol)). Es el mismo agente con la misma memoria y el mismo actions, solo que se llega a través de diferentes canales. Ver [Messaging the agent](/docs/messaging).

### ¿Pueden los agentes hablar entre sí? {#can-agents-talk-to-each-other}

Sí, a través del [A2A (Agent-to-Agent) protocol](/docs/a2a-protocol). Cada aplicación nativa del agente obtiene automáticamente un punto final A2A. Desde la aplicación de correo, puede etiquetar al agente de análisis para consultar datos. Un agente descubre qué otros agentes están disponibles, los llama a través del protocolo y muestra los resultados en UI. No se necesita configuración: la tarjeta de agente se genera automáticamente a partir del actions de su plantilla.

### ¿Qué puede ver el agente en la aplicación? {#what-can-the-agent-see}

El agente siempre sabe lo que el usuario está viendo actualmente. El UI escribe el estado de navegación en la base de datos en cada cambio de ruta: qué vista está abierta, qué elemento está seleccionado. El agente lee esto antes de actuar. Si un correo electrónico está abierto, el agente sabe qué correo electrónico. Si se selecciona una diapositiva, el agente sabe qué diapositiva. Ver [Context Awareness](/docs/context-awareness).

## Preguntas de desarrollo {#development}

### ¿Qué herramientas de codificación de IA funcionan con el agente nativo? {#which-ai-tools-work}

Cualquier herramienta de codificación de IA que lea las instrucciones del proyecto. El marco utiliza AGENTS.md como estándar universal y crea automáticamente enlaces simbólicos para herramientas específicas:

- **Código Claude**: lee CLAUDE.md (enlazado simbólicamente desde AGENTS.md mediante la configuración de CLI)
- **Cursor**: lee AGENTS.md directamente o `.cursorrules` (ubicación heredada del cursor) si está presente en su proyecto
- **Windsurf**: lee .windsurfrules (enlazado simbólicamente desde AGENTS.md mediante la configuración de CLI)
- **Codex, Gemini y otros**: trabaje a través del panel de agente integrado
- **Builder.io**: agente alojado en la nube con edición visual y colaboración

### ¿Puedo usar mi propia base de datos? {#can-i-use-my-own-database}

Sí. Configure `DATABASE_URL` y el marco lo detectará automáticamente. Las bases de datos compatibles incluyen SQLite, Postgres (Neon, Supabase, Plain), Turso (libSQL) y Cloudflare D1. Todo SQL es independiente del dialecto a través de Drizzle ORM: el mismo código funciona en todas partes.

### ¿Dónde puedo implementar? {#where-can-i-deploy}

En cualquier lugar. El servidor se ejecuta en Nitro, que se compila en cualquier objetivo de implementación: Node.js, Cloudflare Workers/Pages, Netlify, Vercel, Deno Deploy, AWS Lambda y Bun. También puede utilizar el alojamiento de Builder.io para implementaciones administradas. Ver el [Deployment guide](/docs/deployment).

## Arquitectura {#architecture}

### ¿Por qué SSE más encuestas en lugar de WebSocket? {#why-polling-not-websockets}

SSE proporciona a las escrituras del mismo proceso una ruta inmediata al navegador, y una encuesta ligera de contador de versiones sigue siendo la alternativa porque funciona en todos los entornos de implementación, incluidos los sin servidor y los perimetrales, donde es posible que los sockets persistentes no estén disponibles. Ver [Key Concepts — Sincronización en vivo](/docs/key-concepts#polling-sync).

```an-diagram title="SSE primero, respaldo de encuesta" summary="Las escrituras en el mismo proceso se transmiten al instante; una encuesta de contador de versiones mantiene convergentes las escrituras sin servidor, perimetrales y entre procesos."
{
  "html": "<div class=\"diagram-transport\"><div class=\"diagram-box\" data-rough>Escritura en BD</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">SSE<br><small class=\"diagram-muted\">/_agent-native/events &middot; instant</small></div><div class=\"diagram-node\">Sondeo<br><small class=\"diagram-muted\">/_agent-native/poll &middot; universal fallback</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Recarga del navegador</div></div>",
  "css": ".diagram-transport{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-transport .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-transport .diagram-arrow{font-size:22px;line-height:1}"
}
```

### ¿Por qué el UI no puede llamar directamente a un LLM? {#why-no-inline-llm-calls}

La IA no es determinista, por lo que necesita un flujo de conversación para brindar retroalimentación e iteración (no botones de un solo uso) y el agente ya tiene su código base, instrucciones, skills y el historial del que carece una llamada en línea. Dirigir todo a través del agente también es lo que permite que la aplicación se controle desde Slack, Telegram u otro agente. Ver [Key Concepts — Agent chat bridge](/docs/key-concepts#agent-chat-bridge).

### ¿Por qué es esto un marco y no una biblioteca? {#why-framework-not-library}

La base de datos compartida, la sincronización en vivo, el sistema actions y el estado de la aplicación solo funcionan porque están conectados desde cero: el UI reacciona instantáneamente a los cambios del agente, los agentes se comunican y el agente comprende lo que el usuario está mirando. Una biblioteca te da piezas; esto es una arquitectura. Ver [Key Concepts](/docs/key-concepts).
