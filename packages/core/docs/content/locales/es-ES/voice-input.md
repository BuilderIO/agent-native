---
title: "Entrada de voz"
description: "Dictado de voz en el compositor de chat del agente: Builder Gemini, proveedores BYOK y reserva de voz web del navegador."
---

# Entrada de voz

Cada aplicación nativa del agente tiene un micrófono en el compositor de chat. Haga clic en él, hable y sus palabras se transcribirán en el mensaje. Útil en dispositivos móviles, útil para mensajes largos, útil cuando tienes otra cosa entre manos.

El marco maneja todo esto automáticamente. Los usuarios conectados a Builder obtienen Gemini Flash-Lite alojado en Builder de forma predeterminada; de lo contrario, los usuarios pueden traer su propia clave de proveedor o recurrir al reconocimiento de voz del navegador.

## Cómo funciona {#how-it-works}

El botón de voz del compositor graba audio en el navegador y luego elige un proveedor:

1. **Builder Gemini Flash-Lite (predeterminado cuando Builder está conectado).** El navegador envía audio a `/_agent-native/transcribe-voice`, que actúa como proxy a través de Builder.io usando Gemini Flash-Lite. No se requiere ninguna clave API de Google.
2. **Proveedores de nube BYOK.** Los usuarios pueden elegir Google Gemini, Groq Whisper o OpenAI Whisper en Configuración. La ruta resuelve secretos cifrados de ámbito de usuario antes que las credenciales de implementación compartidas.
3. **Voz web del navegador API (alternativa).** Si no hay ningún proveedor de servidor disponible, el compositor puede utilizar el reconocimiento de voz integrado del navegador. Funciona en navegadores basados ​​en Chromium (Chrome, Edge, Arc) y Safari. Menos preciso; transmite en vivo.

La elección del proveedor se almacena en el estado de la aplicación en `voice-transcription-prefs` para que el usuario pueda forzar `"auto"` (predeterminado: elige el mejor proveedor disponible), `"builder-gemini"`, `"builder"`, `"gemini"`, `"groq"`, `"openai"` o `"browser"` en la configuración de la barra lateral.

```an-diagram title="Voice transcription provider fallback" summary="The composer records audio, then walks server providers in order, dropping to the browser Web Speech API only when no server provider is available."
{
  "html": "<div class=\"diagram-voice\"><div class=\"diagram-node\">Mic button<br><small class=\"diagram-muted\">records webm/opus</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill accent\">1 &middot; Builder Gemini</div><small class=\"diagram-muted\">default when Builder connected</small><div class=\"diagram-pill\">2 &middot; BYOK cloud</div><small class=\"diagram-muted\">Gemini &middot; Groq &middot; OpenAI Whisper</small></div><div class=\"diagram-arrow diagram-warn\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box diagram-warn\" data-rough>3 &middot; Browser Web Speech<br><small class=\"diagram-muted\">fallback on 400 &middot; streams live</small></div></div>",
  "css": ".diagram-voice{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-voice .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-voice .diagram-arrow{font-size:22px;line-height:1}"
}
```

La ruta es **solo del mismo origen**: las POST entre sitios se rechazan para que un atacante no pueda grabar créditos de transcripción desde una página externa.

## Habilitación de proveedores {#enabling-providers}

Builder es el camino más fácil: conecte Builder.io desde Configuración y el proveedor predeterminado será Builder Gemini Flash-Lite. Para proveedores BYOK, agregue la clave coincidente en Configuración → Claves API.

### Por usuario (recomendado para SaaS)

El usuario establece su propia clave a través de la configuración de la barra lateral del agente UI. Se almacena como un secreto cifrado exclusivo del usuario (a través de `readAppSecret`). Cada usuario paga por su propia transcripción; coste cero para el anfitrión.

### Compartido (para herramientas internas)

Establezca `GEMINI_API_KEY`, `GROQ_API_KEY` o `OPENAI_API_KEY` como una variable de entorno o en la tabla `settings`. La transcripción de cada usuario llega a la clave compartida.

```an-callout
{
  "tone": "info",
  "body": "**Credential resolution order:** the route checks the user's own encrypted secret first, then the shared deployment key. A power user with their own key always overrides the shared one. If neither exists, the route returns a 400 the composer recognizes and silently falls back to browser Web Speech."
}
```

## la ruta {#route}

```an-api title="Voice transcription route"
{
  "method": "POST",
  "path": "/_agent-native/transcribe-voice",
  "summary": "Transcribe a recorded audio clip into prompt text",
  "auth": "Active session (Better Auth cookie). Same-origin only.",
  "description": "The composer POSTs the recorded clip here; the route resolves a provider and returns the transcribed text. You should not call this directly.",
  "params": [
    { "name": "audio", "in": "body", "type": "file", "required": true, "description": "The recorded clip, webm/opus by default. Max 25 MB." },
    { "name": "provider", "in": "body", "type": "string", "required": false, "description": "Optional override, e.g. gemini, groq, openai, builder." }
  ],
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "Transcription succeeded", "example": "{ \"text\": \"reply to Sara that I'll be there by 3\" }" },
    { "status": "400", "description": "No server provider configured — the composer recognizes this and falls back to Web Speech", "example": "{ \"error\": \"no_provider\" }" }
  ]
}
```

No es necesario llamar a esto directamente: el compositor lo hace. Si está creando una superficie de entrada personalizada, primero reutilice las piezas compartidas del compositor/cliente de voz de `@agent-native/core/client`. Trate esta ruta como el límite de transporte de bajo nivel para los asistentes personalizados que necesitan enviar audio multiparte.

## Personalizar el proveedor {#customizing}

El campo del proveedor es una clave simple de estado de la aplicación, por lo que el agente puede cambiarla si lo solicita (`"use the browser speech recognizer instead"`). Si está creando una plantilla con requisitos diferentes (por ejemplo, una implementación de Whisper local), cambie el controlador de ruta registrando su propia ruta `transcribe-voice` antes de que el marco monte la ruta predeterminada.

## ¿Qué sigue?

- [**Drop-in Agent**](/docs/drop-in-agent) — el compositor que expone el botón de voz
- [**Onboarding**](/docs/onboarding): registro de claves de proveedor como pasos de configuración
- [**Security & Data Scoping**](/docs/security): cómo se almacenan los secretos cifrados por usuario
