---
title: "Instalador de planos"
description: "Agent-native add imprime una receta de integración Markdown seleccionada en la salida estándar; canalícela a su agente de codificación, que aplica los cambios en su repositorio en vivo."
---

# Instalador de planos

> **Para quién es:** autores e integradores de hosts que agregan un proveedor y un canal
> backend sandbox o acción en un repositorio canalizando una receta a su agente de codificación.

`agent-native add` **no** es un andamio tonto que escribe archivos por usted. Emite un _plan de integración_ Markdown seleccionado para la salida estándar. Canalizas ese plano en tu propio agente de codificación (Código Claude, Codex,...), que aplica los cambios en el repositorio en vivo con contexto completo.

Esto encaja con el estilo interno de agente-aplica-cambios, sistema de archivos primero: el marco proporciona la receta (los archivos canónicos que tocar, las reglas que respetar, el paso de verificación) y el agente codificador hace la edición.

```bash
agent-native add provider stripe | claude
agent-native add channel discord  | codex
```

```an-diagram title="agregar imprime una receta; su agente codificador lo aplica" summary="agent-native emite un plano de Markdown para stdout (diagnóstico para stderr); lo canaliza a Claude Code o Codex, que edita su repositorio en vivo con contexto completo."
{
  "html": "<div class=\"diagram-bp\"><div class=\"diagram-node\" data-rough>agent-native add<br><small class=\"diagram-muted\">&lt;kind&gt; &lt;name|URL&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Blueprint Markdown<br><small class=\"diagram-muted\">stdout · archivos por tocar · reglas · verificar</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>Agente de código<br><small class=\"diagram-muted\">claude · codex</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">edits your live repo</div></div>",
  "css": ".diagram-bp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bp .diagram-arrow{font-size:22px;line-height:1}.diagram-bp .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Uso {#usage}

```bash
agent-native add <kind> <name>            # print a curated blueprint
agent-native add <kind> <https://docs…>   # investigar e integrar desde un URL
agent-native add --list                   # list available kinds and blueprints
```

- Un **nombre** simple resuelve un plano seleccionado de `blueprints/<kind>/<name>.md`.
- Un **URL** en lugar de un nombre emite un modelo genérico de _investigación e integración_ para ese tipo, con el URL integrado como punto de partida de la investigación (un URL es una semilla de investigación, no una receta conocida).
- El plano va a **stdout**; los diagnósticos van a stderr, por lo que `… | claude` solo recibe el plano.

## Planos sembrados {#seeded}

`agent-native add --list` muestra lo que se incluye en la caja:

| Amable     | Nombre    | Qué configura                                                                                      |
| ---------- | --------- | -------------------------------------------------------------------------------------------------- |
| `provider` | `stripe`  | Conecte un proveedor al sustrato `provider-api` (catálogo/docs/solicitud trío).                    |
| `channel`  | `discord` | Implemente un canal de webhook entrante `PlatformAdapter` y regístrelo.                            |
| `sandbox`  | `docker`  | Implemente la unión `SandboxAdapter` para ejecutar `run-code` en un contenedor Docker.             |
| `action`   | `crud`    | Agregue un único `defineAction` de múltiples superficies con un esquema Zod (un `update` sobre N). |

Cada plano es autónomo: el agente de codificación que lo lee obtiene los archivos que debe tocar, las reglas del marco que debe respetar (actions son la única fuente de verdad, nunca codifica secretos, abarca los datos que se pueden poseer, agrega un conjunto de cambios para la fuente `packages/*`) y una sección concreta de **Verificación**.

## URL → plano de investigación {#url}

Cuando pasas un URL del tipo que no tiene una receta seleccionada (o no quieres una nueva integración), `add` emite un plan genérico de "investigación e integración" con el URL como semilla:

```bash
agent-native add provider https://docs.example.com/api | claude
```

El plano generado le indica al agente de codificación que busque el URL (y las páginas a las que vincula) para los puntos finales reales, el modelo de autenticación, las formas de carga útil y los requisitos de firma/verificación (no\_ que adivine a partir de los datos de entrenamiento), luego lo implemente y lo verifique. También incluye orientación específica del tipo (por ejemplo, un `provider` URL se dirige hacia el sustrato `provider-api`; un `channel` URL hacia un `PlatformAdapter`).

## Añadiendo tu propio plano {#authoring}

Coloque un archivo Markdown en `packages/core/blueprints/<kind>/<name>.md`. El tipo es el subdirectorio; el nombre es el nombre del archivo sin `.md`. Se recoge automáticamente: `--list`, la resolución de nombres y el catálogo leen el directorio en tiempo de ejecución. No es necesario cambiar el código para registrarlo.

Los archivos Blueprint `.md` se envían en el paquete publicado a través de la entrada `blueprints` en `package.json` `files`, por lo que se resuelven en `node_modules/@agent-native/core/blueprints/**` para los usuarios finales.

Escriba cada plano como un conjunto de instrucciones para un agente de codificación sin otro contexto. Un buen plano tiene:

1. **Un objetivo de una línea** y un encuadre "usted es un agente de codificación en una aplicación nativa del agente, aplíquelos como cambios de fuente reales".
2. **Lea primero**: los archivos exactos que _son_ el contrato.
3. **Archivos para tocar**: rutas concretas y lo que hace cada cambio.
4. **Reglas marco que hay que respetar**: actions: primero, sin secretos codificados, alcance de los datos de propiedad, agregue un conjunto de cambios para la fuente del paquete publicable.
5. **Verificar**: verificación de tipo, un `*.spec.ts` enfocado y una verificación de extremo a extremo.

> [!TIP]
> Un nuevo plano seleccionado bajo un tipo existente no necesita código, pero si crea un directorio de tipo nuevo, ese tipo también aparece automáticamente en `--list`.

## ¿Qué sigue?

- [**Sandbox Adapters**](/docs/sandbox-adapters): la costura a la que apunta el plano `add sandbox docker`
- [**Actions**](/docs/actions): la única fuente de verdad en la que se basa cada proyecto
- [**External Agents**](/docs/external-agents): conectar el agente de codificación al que canalizas los planos
