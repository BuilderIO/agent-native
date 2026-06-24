---
title: "Entrada de voz"
description: "Ditado de voz no compositor de bate-papo do agente — Builder Gemini, provedores BYOK e substituto de Web Speech do navegador."
---

# Entrada de voz

Todo aplicativo nativo do agente possui um microfone no compositor de bate-papo. Clique nele, fale e suas palavras serão transcritas no prompt. Útil em dispositivos móveis, útil para solicitações longas, útil quando você está em outra coisa.

A estrutura lida com tudo isso automaticamente. Os usuários conectados ao Builder obtêm o Gemini Flash-Lite hospedado no Builder por padrão; caso contrário, os usuários poderão trazer sua própria chave de provedor ou recorrer ao reconhecimento de fala do navegador.

## Como funciona {#how-it-works}

O botão de voz do compositor grava o áudio no navegador e depois escolhe um provedor:

1. **Builder Gemini Flash-Lite (padrão quando Builder está conectado).** O navegador envia áudio para `/_agent-native/transcribe-voice`, que faz proxy através de Builder.io usando Gemini Flash-Lite. Não é necessária nenhuma chave Google API.
2. **Provedores de nuvem BYOK.** Os usuários podem escolher Google Gemini, Groq Whisper ou OpenAI Whisper em Configurações. A rota resolve segredos criptografados no escopo do usuário antes das credenciais de implantação compartilhadas.
3. **Fala da Web do navegador API (substituição).** Se nenhum provedor de servidor estiver disponível, o compositor poderá usar o reconhecimento de fala integrado do navegador. Funciona em navegadores baseados em Chromium (Chrome, Edge, Arc) e Safari. Menos preciso; transmite ao vivo.

A escolha do provedor é armazenada no estado do aplicativo em `voice-transcription-prefs` para que o usuário possa forçar `"auto"` (padrão - escolhe o melhor provedor disponível), `"builder-gemini"`, `"builder"`, `"gemini"`, `"groq"`, `"openai"` ou `"browser"` nas configurações da barra lateral.

```an-diagram title="Substituição do provedor de transcrição de voz" summary="O compositor grava o áudio e, em seguida, percorre os provedores de servidores em ordem, acessando o navegador Web Speech API somente quando nenhum provedor de servidor estiver disponível."
{
  "html": "<div class=\"diagram-voice\"><div class=\"diagram-node\">Mic button<br><small class=\"diagram-muted\">records webm/opus</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill accent\">1 &middot; Builder Gemini</div><small class=\"diagram-muted\">default when Builder connected</small><div class=\"diagram-pill\">2 &middot; BYOK cloud</div><small class=\"diagram-muted\">Gemini &middot; Groq &middot; OpenAI Whisper</small></div><div class=\"diagram-arrow diagram-warn\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box diagram-warn\" data-rough>3 &middot; Browser Web Speech<br><small class=\"diagram-muted\">fallback on 400 &middot; streams live</small></div></div>",
  "css": ".diagram-voice{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-voice .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-voice .diagram-arrow{font-size:22px;line-height:1}"
}
```

A rota é **somente da mesma origem** — POSTs entre sites são rejeitados para que um invasor não possa gravar créditos de transcrição de uma página externa.

## Habilitando provedores {#enabling-providers}

Builder é o caminho mais fácil: conecte Builder.io em Configurações e o provedor padrão se tornará Builder Gemini Flash-Lite. Para provedores BYOK, adicione a chave correspondente em Configurações → Chaves API.

### Por usuário (recomendado para SaaS)

O usuário define sua própria chave por meio das configurações da barra lateral do agente UI. Ele é armazenado como um segredo criptografado no escopo do usuário (via `readAppSecret`). Cada usuário paga pela sua própria transcrição; custo zero para o anfitrião.

### Compartilhado (para ferramentas internas)

Defina `GEMINI_API_KEY`, `GROQ_API_KEY` ou `OPENAI_API_KEY` como uma variável de ambiente ou na tabela `settings`. A transcrição de cada usuário atinge a chave compartilhada.

```an-callout
{
  "tone": "info",
  "body": "**Credential resolution order:** the route checks the user's own encrypted secret first, then the shared deployment key. A power user with their own key always overrides the shared one. If neither exists, the route returns a 400 the composer recognizes and silently falls back to browser Web Speech."
}
```

## A rota {#route}

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

Você não precisa chamar isso diretamente — o compositor precisa. Se você estiver construindo uma superfície de entrada personalizada, primeiro reutilize as peças compartilhadas do compositor/cliente de voz do `@agent-native/core/client`. Trate esta rota como o limite de transporte de baixo nível para auxiliares personalizados que precisam enviar áudio multiparte.

## Personalizando o provedor {#customizing}

O campo do provedor é uma chave simples de estado do aplicativo, portanto o agente pode alterá-la mediante solicitação (`"use the browser speech recognizer instead"`). Se você estiver criando um modelo com requisitos diferentes (por exemplo, uma implantação local do Whisper), troque o manipulador de rota registrando sua própria rota `transcribe-voice` antes que a estrutura monte o padrão.

## O que vem a seguir

- [**Drop-in Agent**](/docs/drop-in-agent) — o compositor que expõe o botão de voz
- [**Onboarding**](/docs/onboarding) — registrando chaves de provedor como etapas de configuração
- [**Security & Data Scoping**](/docs/security) — como os segredos criptografados são armazenados por usuário
