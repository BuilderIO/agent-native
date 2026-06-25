---
title: "Diseño"
description: "Un estudio de creación de prototipos HTML nativo del agente: genere, refine, obtenga una vista previa y exporte diseños interactivos Alpine/Tailwind con un agente."
---

# Diseño

Design es un estudio de creación de prototipos HTML nativo del agente. En lugar de un lienzo de dibujo en capas, el agente genera prototipos completos e independientes de Alpine/Tailwind HTML, los representa en un iframe y le permite refinar el resultado con indicaciones y controles de ajuste.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Página de lanzamiento del producto</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>Prototipo HTML generado</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>Haz el hero más denso y el CTA más claro.</span><div style='flex:1'></div><button class='primary'>Aplicar revisión</button></div></div></div>"
}
```

Cuando abre la aplicación, el prototipo generado es el centro del espacio de trabajo, con modos de vista previa, revisiones rápidas y controles de exportación al alcance de la mano. Todo lo que produce el agente es HTML real que puedes refinar, exportar o transferir.

```an-diagram title="Un artefacto, sin traducción" summary="El agente genera Alpine/Tailwind HTML independiente; el iframe, la fuente editable y cada exportación leen los mismos archivos. Un sistema de diseño vinculado introduce tokens en cada pasada."
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">Prompt<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">Sistema de diseño</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Generación del agente</span><small class=\"diagram-muted\">archivos HTML / JSX independientes</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">ajusta controles · refina con Cmd+I</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · entrega</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Cuándo elegirlo

- **Quieres un concepto de página de destino pulido, una dirección de producto UI o una exploración de marca** que pueda dejar la herramienta como HTML real, no como un lienzo de dibujo en capas.
- **Quieres un prototipo interactivo funcional**, con el estilo Alpine interactions y Tailwind, en lugar de maquetas estáticas.
- **Quieres comparar direcciones rápidamente**, generar algunas variantes, elegir la más fuerte y seguir perfeccionando.
- **Quieres un resultado de diseño propio**: exporta HTML, ZIP o PDF, o entrega el prototipo a una herramienta de codificación.

## Qué puedes hacer con él

- **Genere prototipos completos.** Describa la pantalla o página que necesita y el agente creará un documento funcional HTML con estilo Tailwind y Alpine interactions.
- **Compara variantes.** Comience con varias direcciones, elija la más fuerte y luego continúe perfeccionando.
- **Ajuste visualmente.** Utilice los controles de ajuste integrados para realizar cambios comunes o solicite al agente actualizaciones de copia, diseño, color, espaciado e interacción.
- **Aplica sistemas de diseño.** Guarda y reutiliza las preferencias del sistema de diseño para que el trabajo generado esté más cerca de tu marca.
- **Importar referencias.** Traer HTML existente o material de referencia como contexto para un nuevo pase de diseño.
- **Exportar archivos reales.** Exportar HTML, ZIP o PDF desde el prototipo generado.

## Para empezar

Demostración en vivo: [design.agent-native.com](https://design.agent-native.com).

1. **Describe el artefacto.** Pregunte por la pantalla, el flujo, la página de destino o el elemento visual
   dirección que desees. Incluya la audiencia, el tono y cualquier limitación del producto.
2. **Compara direcciones.** Genera algunas variantes, elige la más fuerte y
   sigue refinando en lugar de empezar de nuevo.
3. **Perfecciona los detalles.** Usa controles de ajuste para cambios visuales comunes o pregunta
   el agente para cambios de diseño, copia, capacidad de respuesta e interacción.
4. **Exporta cuando sea útil.** Descarga HTML, ZIP o PDF una vez que tengas el prototipo
   está listo para entregárselo a otra herramienta o compañero de equipo.

### Indicaciones útiles

- "Crear tres direcciones de página de destino para un producto de análisis técnico".
- "Haga que este panel sea más denso y más fácil de escanear para un equipo de operaciones."
- "Aplica nuestro sistema de diseño guardado y simplifica el diseño móvil."
- "Exporta este prototipo como ZIP una vez seleccionada la variante final."
- "Convierta este HTML en una página de precios más sólida sin cambiar los colores de la marca".

## Para desarrolladores

El resto de este documento es para cualquiera que bifurque la plantilla de Diseño o la extienda.

### Inicio rápido

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### Modelo de datos

Todos los datos residen en SQL a través de Drizzle ORM. Esquema: `templates/design/server/db/schema.ts`. Los diseños y los sistemas de diseño llevan el estándar `ownableColumns` y una tabla de recursos compartidos de marco correspondiente, por lo que encajan en el modelo de uso compartido por usuario/por organización.

| Tabla                                    | Qué contiene                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | Un proyecto de diseño: `title`, `description`, `project_type` (`prototype` / `other`), el blob `data` JSON y un enlace `design_system_id` opcional |
| `design_files`                           | Archivos individuales que pertenecen a un diseño (`filename`, `content`, `file_type` por defecto `html`)                                           |
| `design_versions`                        | `snapshot` puntuales de un diseño con un `label` opcional, para historial y reversión                                                              |
| `design_systems`                         | Tokens de marca reutilizables: `data` (colores/tipografía/espaciado), `assets`, `custom_instructions` y una bandera `is_default`                   |
| `design_shares` / `design_system_shares` | El marco comparte tablas que asignan principales (usuarios u organizaciones) a roles (visor, editor, administrador)                                |

```an-schema title="Modelo de datos de diseño" summary="Un diseño posee sus archivos e instantáneas versionadas y, opcionalmente, vincula un sistema de diseño reutilizable. Tanto los diseños como los sistemas son propios, cada uno con una tabla de acciones de marco."
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "Archivos en un diseño.", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "Historial / reversión", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "Tabla de acciones del marco", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "Tabla de acciones del marco", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

Un proyecto de diseño es un shell hasta que tiene contenido: `create-design` crea una fila vacía (`data: "{}"`), luego `generate-design` escribe los archivos HTML/JSX independientes reales. El artefacto generado, la fuente editable y cada exportación provienen del mismo HTML, por lo que no existe un formato de "maqueta de IA" independiente para traducir. Un sistema de diseño vinculado proporciona tokens y `custom_instructions` que el agente honra en cada paso de generación.

Las rutas en UI se encuentran bajo `templates/design/app/routes/`: `_index.tsx` (lista), `design.$id.tsx` (editor), `present.$id.tsx` (presentación), `design-systems.tsx` y `design-systems_.setup.tsx`, `templates.tsx`, `examples.tsx`, además de `settings.tsx` y `team.tsx`.

### Clave actions

Cada operación invocable por el agente es un archivo TypeScript en `templates/design/actions/`, automontado en `POST /_agent-native/actions/:name` y ejecutable desde CLI como `pnpm action <name>`. Las agrupaciones:

- **Diseños**: `create-design` (cáscara vacía), `generate-design` (contenido de HTML/JSX generado por escritura), `update-design`, `get-design`, `list-designs`, `duplicate-design`, `delete-design` y `apply-tweaks` para conservar los valores de las perillas de ajuste en vivo (color de acento, densidad, etc.).
- **Archivos**: `create-file`, `update-file`, `list-files`, `delete-file` para los archivos dentro de un proyecto de diseño.
- **Sistemas de diseño**: `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `delete-design-system`, `set-default-design-system` y `analyze-brand-assets` para recopilar datos de marca antes del análisis.
- **Importar**: `import-code`, `import-figma`, `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF/XLSX) y `import-design-project` para sacar un sistema de diseño de un proyecto existente.
- **Exportación y transferencia**: `export-html`, `export-pdf`, `export-svg`, `export-zip` y `export-coding-handoff` para convertir un diseño en una transferencia de herramienta de codificación.
- **Contexto y navegación**: `view-screen` (diseño actual, archivo abierto, vista, pregunta pendiente o cuadrícula de variantes), `get-design-snapshot` (estado actual desde el cual un agente externo puede continuar) y `navigate`.

### Trabajar con el agente

El agente siempre sabe lo que tienes abierto. `view-screen` devuelve el diseño actual, el archivo abierto, la vista activa y cualquier pregunta pendiente o cuadrícula variante y los inyecta en cada mensaje, por lo que puede decir "hacer esto más denso" o "exportar esta variante" sin nombrar el diseño.

Debido a que un diseño son solo archivos HTML/JSX independientes, el agente edita la misma fuente que representa el iframe y de donde proviene cada exportación; no hay un formato de "maqueta de IA" independiente para traducir. Un sistema de diseño vinculado proporciona tokens y `custom_instructions` el agente honra en cada paso de generación. Seleccione texto o una región en la vista previa y presione Cmd+I para enfocar al agente exactamente en esa parte.

### Personalizarlo

El diseño es una plantilla completa y clonable. Algunas ideas prácticas de extensión:

- "Agregue un sistema de diseño de comercio electrónico reutilizable con nuestros tokens y componentes de muestra."
- "Agregue un paso de exportación que suba el ZIP a nuestro sistema de revisión interno."
- "Permítame pegar la página de destino existente HTML y pedirle al agente tres versiones más potentes".
- "Agregue una biblioteca de mensajes guardados para la página del producto, el panel y los resúmenes de la pantalla de incorporación".
- "Agregue un ajuste preestablecido de exportación PDF personalizado para que las partes interesadas lo revisen."

El agente edita rutas, componentes y modelos respaldados por actions y SQL según sea necesario. Consulte [Templates](/docs/cloneable-saas) para ver el flujo completo de clonación, personalización e implementación y [Getting Started](/docs/getting-started) si esta es su primera plantilla nativa de agente.

## ¿Qué sigue?

- [**Templates**](/docs/cloneable-saas): el modelo de clonar y poseer
- [**Context Awareness**](/docs/context-awareness): cómo sabe el agente lo que está viendo el usuario
- [**Creating Templates**](/docs/creating-templates): patrones de compilación actuales para plantillas nativas del agente
