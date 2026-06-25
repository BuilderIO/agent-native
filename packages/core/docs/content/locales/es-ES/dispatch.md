---
title: "Envío"
description: "El plano de control del espacio de trabajo: bóveda de secretos, centro de integración, delegado entre aplicaciones y bandeja de entrada central para Slack, correo electrónico, Telegram y WhatsApp."
---

# Envío

Dispatch es la aplicación central que se ubica frente a todas las demás aplicaciones en su espacio de trabajo y maneja secretos, integraciones, mensajería y delegación entre aplicaciones. Es el **plano de control del espacio de trabajo**: el único agente con el que habla su equipo, las credenciales del único lugar en vivo y el único enrutador que decide qué aplicación especializada debe manejar una solicitud determinada.

> **Dispatch la plantilla frente a `@agent-native/dispatch` el paquete.** Esta página cubre el concepto de aplicación/plantilla Dispatch: qué hace y por qué lo desea. El paquete `@agent-native/dispatch` npm es el tiempo de ejecución publicado por separado que agrupa la lógica del servidor de la plantilla de Dispatch (bóveda, integraciones, destinos, trabajos programados y delegación entre aplicaciones) como un paquete directo para espacios de trabajo que lo amplían. Para conocer la aplicación estructurada (rutas, pantallas, guía del agente), consulte [Dispatch template](/docs/template-dispatch).

Sin Dispatch, cada aplicación en un espacio de trabajo de múltiples aplicaciones termina reimplementando la misma plomería: su propio bot Slack, su propio almacén secreto, sus propios trabajos programados, su propia copia de las instrucciones del espacio de trabajo. Girar una tecla API se convierte en diez redespliegues. Agregar una nueva política se convierte en diez copiar y pegar. Dispatch centraliza todo eso en una aplicación para que los demás se mantengan concentrados en su dominio.

```an-diagram title="Dispatch como plano de control del espacio de trabajo" summary="Una bandeja de entrada, una bóveda, una puerta de enlace MCP y recursos compartidos se encuentran frente a las aplicaciones del dominio, a las que Dispatch llega como pares A2A."
{
  "html": "<div class=\"dsp-hub\"><div class=\"diagram-node\">Users &amp; external agents<br><small class=\"diagram-muted\">Slack · correo · Telegram · WhatsApp · MCP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel dsp-control\" data-rough><span class=\"diagram-pill accent\">Dispatch &mdash; control plane</span><div class=\"dsp-caps\"><span class=\"diagram-pill\">Bandeja central</span><span class=\"diagram-pill\">Bóveda de secretos</span><span class=\"diagram-pill\">Delegación entre apps</span><span class=\"diagram-pill\">MCP gateway</span><span class=\"diagram-pill\">Recursos del espacio de trabajo</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"dsp-peers\"><div class=\"diagram-box\" data-rough>Mail</div><div class=\"diagram-box\" data-rough>Calendar</div><div class=\"diagram-box\" data-rough>Analytics</div></div><small class=\"diagram-muted\">domain apps &mdash; A2A peers</small></div>",
  "css": ".dsp-hub{display:flex;flex-direction:column;align-items:center;gap:10px}.dsp-hub .dsp-control{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}.dsp-hub .dsp-caps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.dsp-hub .dsp-peers{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}"
}
```

## Cuando quieras el envío {#when}

Acceda a Dispatch cuando se cumpla alguna de estas condiciones:

- Estás ejecutando un [multi-app workspace](/docs/multi-app-workspace) (correo, calendario, análisis, contenido) y no quieres un bot Slack por aplicación.
- Quieres **una bandeja de entrada para "el agente"** para que los usuarios envíen mensajes de texto a un único bot y la aplicación especializada adecuada se encargue del trabajo entre bastidores.
- Tienes **secretos para todo el espacio de trabajo** (clave Stripe, clave OpenAI, tokens API de terceros) que varias aplicaciones necesitan y quieres una bóveda en lugar de copiar valores en cada `.env`.
- Desea un **flujo de aprobación en tiempo de ejecución** delante de los cambios confidenciales (destinos guardados, ediciones de políticas) para que los no administradores puedan solicitar y los administradores puedan cerrar sesión sin implementar el código.
- Quiere **skills, instrucciones, perfiles de agente y servidores MCP compartidos** que las aplicaciones en el espacio de trabajo hereden: cambie una vez y llegue a todos.

Si está ejecutando una única plantilla independiente, no necesita Dispatch: cada plantilla puede conectar sus propias integraciones de mensajería directamente. Consulte [Messaging](/docs/messaging) para conocer la configuración independiente.

## Qué hace Dispatch {#what-it-does}

Siete capacidades, todas ubicadas encima de la misma base de datos del espacio de trabajo que usan las otras aplicaciones:

| Capacidad                           | Lo que te aporta                                                                                             | Configurarlo                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Bandeja de entrada central**      | Slack, correo electrónico, Telegram y WhatsApp llegan a un solo agente con memoria compartida y herramientas | **Configuración → Mensajería** ([Messaging](/docs/messaging)) |
| **Bóveda secreta**                  | Almacene cada credencial una vez; rotar en un solo lugar en cada aplicación                                  | **Vault** + modo de acceso (todas las aplicaciones o manual)  |
| **Delegación entre aplicaciones**   | Envía una solicitud a la aplicación especializada adecuada a través de A2A y responde en el hilo             | Automático ([A2A](/docs/a2a-protocol))                        |
| **Puerta de enlace MCP unificada**  | Un conector MCP para agentes externos llega a todas las aplicaciones del espacio de trabajo otorgado         | [External Agents](/docs/external-agents)                      |
| **Recursos del espacio de trabajo** | Autor skills/instrucciones/perfiles una vez; las aplicaciones los heredan en tiempo de ejecución             | **Recursos** ([Workspace](/docs/workspace#global-resources))  |
| **Sueños**                          | Revisa ejecuciones y comentarios anteriores y propone mejoras duraderas para que usted las apruebe           | Pestaña **Sueños**                                            |
| **Flujo de aprobación**             | Cambios en el tiempo de ejecución sensibles de la puerta detrás de la revisión del administrador en línea    | **política de aprobación de envío**                           |

Cada uno se detalla a continuación.

### Bandeja de entrada central

Slack, correo electrónico, Telegram y WhatsApp fluyen hacia el bucle de agentes de Dispatch. Conecte cada plataforma una vez en **Configuración → Mensajería** y cada canal llega al mismo agente con la misma memoria y herramientas. Un DM de Slack y un correo electrónico a `agent@yourcompany.com` terminan como dos superficies en un historial de conversación, no como dos bots desconectados. Consulte [Messaging](/docs/messaging) para obtener las credenciales y el webhook URL.

### Bóveda secreta

Almacenar las credenciales una vez en la bóveda de Dispatch. De forma predeterminada, el acceso a la bóveda es **todas las aplicaciones**: cada clave guardada está disponible para cada aplicación del espacio de trabajo y `sync-vault-to-app` envía la bóveda completa a la aplicación de destino. Los espacios de trabajo que necesitan una separación más estricta pueden cambiar la bóveda al modo **manual**, donde se requieren concesiones explícitas por aplicación antes de la sincronización. Los no administradores pueden **solicitar** un secreto para una aplicación; los administradores **aprueban**, que crea el secreto y, en flujos de trabajo manuales, la concesión. Cada lectura, concesión, sincronización y rotación se captura en un registro de auditoría. Esto es lo que hace que "rotar la tecla OpenAI" sea una operación con un solo clic en diez aplicaciones en lugar de diez PR.

### Delegación entre aplicaciones

Dispatch descubre automáticamente las otras aplicaciones en su espacio de trabajo como pares A2A: sin registro manual ni configuración por aplicación. Cuando un usuario pregunta "resumir los registros de la semana pasada" en Slack, Dispatch lo reconoce como una solicitud de análisis y llama a la aplicación de análisis a través de [A2A](/docs/a2a-protocol). Cuando preguntan "redactar una respuesta para Alice", se dirige a la aplicación de correo. Dispatch publica la respuesta final en el hilo de origen. La regla de comportamiento reside en las instrucciones del agente de despacho: el trabajo del dominio pertenece a la aplicación del dominio. Dispatch es el orquestador, no el especialista.

### Puerta de enlace unificada MCP

Dispatch puede ser el único conector MCP para agentes externos: agregue `https://dispatch.agent-native.com/_agent-native/mcp` una vez en Claude, ChatGPT, Codex o Cursor, y una autorización llega a cada aplicación de espacio de trabajo otorgada en lugar de un conector por aplicación. Consulte [External Agents](/docs/external-agents) para conocer el flujo de conexión completo, las concesiones de aplicaciones, OAuth y las vistas previas de la aplicación MCP en línea.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "Punto final de puerta de enlace MCP unificada",
  "description": "The single MCP connector URL external agents add (e.g. `https://dispatch.agent-native.com/_agent-native/mcp`). One authorization here reaches every **granted** workspace app instead of wiring one connector per app. App grants, OAuth, and inline MCP App previews are covered in [External Agents](/docs/external-agents).",
  "auth": "Standard remote MCP OAuth, handled by the framework. The granted-app set scopes which workspace apps the connector can reach.",
  "responses": [
    { "status": "200", "description": "MCP JSON-RPC response — tools, resources, and MCP App UI resources aggregated across granted workspace apps." }
  ]
}
```

### Recursos del espacio de trabajo

Skills, las instrucciones de medida de seguridad, los perfiles de agentes y los recursos de referencia se pueden crear una vez en Dispatch y heredados por el resto del espacio de trabajo. Los recursos con alcance **Todas las aplicaciones** son globales: Dispatch los almacena una vez en el alcance del espacio de trabajo y cada agente de aplicación los lee en tiempo de ejecución. No se copian en cada aplicación y no existe un paso manual de sincronización del espacio de trabajo y los recursos. Los recursos compartidos de la aplicación y los recursos personales pueden anular o limitar los valores predeterminados del espacio de trabajo localmente.

Consulte [Workspace — Global resources](/docs/workspace#global-resources) para conocer la tabla de rutas canónicas, el paquete de inicio y el modelo de anulación.

Los recursos del servidor MCP utilizan JSON e intencionalmente son solo para HTTP. Almacenar tokens en
Dispatch Vault, otorga o sincroniza esas claves con las aplicaciones de destino y haz referencia a ellas
de encabezados con `${keys.NAME}` para que la credencial sin formato nunca viva en el
cuerpo del recurso.

La página **Recursos** resalta el paquete de inicio recomendado para que los administradores puedan ver rápidamente qué archivos existen, restaurar los archivos de inicio que faltan sin sobrescribir los existentes y editar su contenido. Expanda cualquier recurso para obtener una vista previa de su pila de tiempo de ejecución efectiva para una aplicación/usuario seleccionado. Cada tarjeta de aplicación también tiene una vista **Contexto** que muestra exactamente lo que recibe esa aplicación.

### Sueños

Dispatch Dreams revisa ejecuciones anteriores del agente, comentarios, evaluaciones y fallas repetidas para proponer mejoras duraderas. Un informe de sueño es una superficie de revisión, no una reescritura silenciosa: puede sugerir actualizaciones de memoria personal, limpieza de memoria obsoleta, ediciones compartidas de `LEARNINGS.md`, recursos de instrucciones/habilidades/conocimientos/agentes del espacio de trabajo o trabajos recurrentes, y cada propuesta enlaza con las ejecuciones que la justifican. Las instrucciones compartidas y los recursos de todo el equipo requieren revisión antes de aplicarse, especialmente cuando la evidencia proviene de Slack entrante, correo electrónico, Telegram, WhatsApp o contenido web.

Antes de proponer una escritura, Dreams compara la evidencia con el índice de memoria personal, las notas `memory/*.md` existentes y el `LEARNINGS.md` compartido. Si ya se capturó una lección, el informe registra que se omitió; Si un recuerdo personal relacionado parece obsoleto, la propuesta se centra en esa nota existente en lugar de crear un duplicado.

Empiece desde la pestaña **Sueños** en Dispatch. Primero ejecute una revisión manual, abra una hoja de revisión de propuesta para comparar el objetivo actual con el contenido propuesto y la evidencia fuente, luego aplique solo los cambios que desee conservar. Una vez que los informes sean útiles de manera constante, Dispatch puede crear el trabajo soñado recurrente que siga produciendo propuestas sin aplicar automáticamente cambios compartidos o a nivel de instrucción.

### Flujo de aprobación

Dispatch puede bloquear cambios confidenciales en el tiempo de ejecución tras la revisión del administrador. Hoy en día, esto cubre **destinos guardados** (los canales Slack y las direcciones de correo electrónico a las que el agente puede enviar proactivamente), **propuestas de ensueño** compartidas/en equipo, **recursos de espacio de trabajo** creados/actualizados/eliminados en todas las aplicaciones y la **política de aprobación de envío** en sí. Cuando la política está habilitada, el cambio se pone en cola y el agente muestra una vista previa de aprobación en línea directamente en el chat: los administradores aprueban o rechazan sin salir de la conversación.

## Cómo fluye un mensaje Slack a través de Dispatch {#flow}

Recorra un ejemplo de principio a fin. Un usuario envía un mensaje directo al bot: _"resumen los registros de la semana pasada."_

1. **Slack → webhook.** Slack `POST` a `/_agent-native/integrations/slack/webhook` en la aplicación Dispatch. El controlador verifica la firma e **inserta una fila en `integration_pending_tasks`**, luego activa un `POST` autodirigido a su propio procesador y devuelve `200` inmediatamente para que Slack no vuelva a intentarlo.
2. **Ejecución nueva del procesador.** El punto final del procesador se ejecuta en una ejecución de función completamente nueva con su propio tiempo de espera completo. Reclama atómicamente la tarea e inicia el ciclo del agente.
3. **El agente de envío decide.** El agente lee el mensaje, reconoce los "registros" como una intención de análisis e invoca `call-agent` contra el [A2A endpoint](/docs/a2a-protocol) de la aplicación de análisis. El trabajo real de SQL se ejecuta allí.
4. **Respuesta publicada en el hilo.** El agente de análisis devuelve un resultado. Dispatch lo formatea y lo publica nuevamente en el mismo hilo Slack en el que escribió el usuario, utilizando la identidad vinculada, si la hay (de modo que el agente actúa con los permisos del solicitante, no con los del propietario del espacio de trabajo).
5. **Recuperación si algo falla.** Si el procesador falla en pleno funcionamiento (tiempo de espera de A2A, error del agente descendente, congelación de funciones), un trabajo de reintento barre las tareas atascadas cada 60 segundos y vuelve a encender el procesador. Hasta tres intentos antes de que la tarea se marque como `failed`.

```an-diagram title="Un mensaje Slack a través de Dispatch" summary="Slack se pone en cola en SQL, una nueva ejecución lo drena, el agente Dispatch delega el trabajo del dominio en A2A y la respuesta regresa al hilo de origen. Un reintento de 60 segundos recupera cualquier cosa que muera en pleno vuelo."
{
  "html": "<div class=\"dsp-flow\"><div class=\"dsp-row\"><div class=\"diagram-node\">DM de Slack<br><small class=\"diagram-muted\">\"summarize last week's signups\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/slack/webhook</strong><br><small class=\"diagram-muted\">verifica + INSERT tarea pendiente</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">200</div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough><strong>fresh processor</strong><br><small class=\"diagram-muted\">reclama tarea · inicia bucle del agente</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">El agente Dispatch decide</span><small class=\"diagram-muted\">analytics intent &rarr; call-agent</small></div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough>App de analítica<br><small class=\"diagram-muted\">par A2A · ejecuta el trabajo SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">reply posted in thread</div></div><div class=\"diagram-panel dsp-retry\" data-rough><span class=\"diagram-pill warn\">recovery</span> <span class=\"diagram-muted\">if the processor crashes &mdash; A2A timeout, downstream error, freeze &mdash; the 60s retry job re-fires it (&le;3 attempts) so the Slack reply still arrives</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</span></div></div>",
  "css": ".dsp-flow{display:flex;flex-direction:column;gap:12px}.dsp-flow .dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsp-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.dsp-flow .dsp-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

El mismo flujo se aplica al correo electrónico, Telegram y WhatsApp: solo cambia el adaptador.

## Historia de confiabilidad {#reliability}

Todo el proceso está diseñado para sobrevivir en todos los hosts sin servidor (Netlify, Vercel, Cloudflare Workers) sin depender de API de ejecución en segundo plano específicos de la plataforma.

- **Webhook → cola SQL → procesador de nueva ejecución.** El bucle del agente nunca se ejecuta dentro del controlador del webhook. El único trabajo del controlador es verificar, poner en cola y devolver 200. Una nueva ejecución separada drena la cola, por lo que una ejecución lenta del agente nunca puede bloquear el webhook entrante ni hacer que la plataforma vuelva a intentarlo.
- **A2A sondeo de continuación.** Cuando Dispatch delega en otra aplicación, sondea la tarea posterior con un tiempo de espera limitado. Si el agente de nivel inferior tarda demasiado o falla, Dispatch registra la continuación y el trabajo de reintento la retoma; la respuesta Slack del usuario aún llega.
- **A2A entre aplicaciones con firma automática.** Los espacios de trabajo hospedados con varias aplicaciones generan automáticamente credenciales A2A por aplicación en el momento de la implementación, de modo que las aplicaciones en el mismo espacio de trabajo pueden llamarse entre sí sin que usted tenga que pegar un secreto JWT. La capa de descubrimiento de agentes de Dispatch lee esos créditos de la base de datos del espacio de trabajo para que las aplicaciones recién agregadas aparezcan automáticamente como pares a los que se puede llamar.

## Configuración {#setup}

Tres breves pasos:

1. **Crea un espacio de trabajo que incluya Dispatch.** Ejecute `npx @agent-native/core@latest create my-company-platform` y elija `dispatch` junto con las plantillas de dominio que desee. Dispatch vive en `apps/dispatch` y el resto de las aplicaciones se encuentran a su lado. Ver [Multi-App Workspace](/docs/multi-app-workspace).
2. **Conectar mensajes.** Abra **Configuración → Mensajes** en Dispatch y haga clic en conectar para Slack, correo electrónico, Telegram o WhatsApp. Los campos del formulario coinciden con las variables de entorno en el documento [Messaging](/docs/messaging); consulte allí lo que necesita cada plataforma.
3. **Agregue otras aplicaciones.** Ejecute `npx @agent-native/core@latest add-app` desde la raíz del espacio de trabajo para cada aplicación de dominio. Aparecen automáticamente como pares A2A en `list-workspace-apps` de Dispatch: sin registro manual ni edición de tarjetas de agente. Dispatch comenzará a delegarles tan pronto como sus tarjetas de agente estén disponibles.

Luego agregue credenciales a la bóveda y (opcionalmente) cree recursos del espacio de trabajo global en **Recursos**. Las claves de la bóveda aún se pueden sincronizar u otorgar según el modo de acceso; Los recursos del espacio de trabajo de todas las aplicaciones se heredan automáticamente. Si necesita aislamiento secreto por aplicación, cambie la configuración de acceso a la bóveda a manual antes de otorgar aplicaciones individuales.

## Ver también {#see-also}

- [Dispatch template](/docs/template-dispatch): la aplicación estructurada real, con su catálogo de acciones completo y guía para agentes
- [Messaging](/docs/messaging) — conexión de Slack, correo electrónico, Telegram, WhatsApp
- [A2A Protocol](/docs/a2a-protocol): cómo funciona la delegación entre aplicaciones en su interior
- [Multi-App Workspace](/docs/multi-app-workspace): la forma de implementación para la que está diseñado Dispatch
- [Workspace Governance](/docs/workspace-management): gobernanza de git/GitHub que se combina con la gobernanza del tiempo de ejecución de Dispatch
