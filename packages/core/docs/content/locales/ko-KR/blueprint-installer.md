---
title: "청사진 설치 프로그램"
description: "agent-native add는 선별된 Markdown 통합 레시피를 stdout에 인쇄합니다. 이를 코딩 에이전트에 파이프하면 라이브 저장소에 대한 변경 사항이 적용됩니다."
---

# 청사진 설치 프로그램

> **대상:** 공급자, 채널을 추가하는 호스트 작성자 및 통합자
> 샌드박스 백엔드 또는 코딩 에이전트에 레시피를 연결하여 저장소에 대한 작업

`agent-native add`는 파일을 작성해 주는 멍청한 스캐폴더가 **아닙니다**. 선별된 Markdown *통합 청사진*을 stdout으로 내보냅니다. 해당 청사진을 자체 코딩 에이전트(Claude 코드, Codex, …)에 파이프하면 전체 컨텍스트가 포함된 라이브 저장소에 대한 변경 사항이 적용됩니다.

이것은 에이전트 적용 변경 사항, 파일 시스템 우선 하우스 스타일에 적합합니다. 프레임워크는 레시피(접촉할 표준 파일, 준수할 규칙, 확인 단계)를 제공하고 코딩 에이전트는 편집을 수행합니다.

```bash
agent-native add provider stripe | claude
agent-native add channel discord  | codex
```

```an-diagram title="add는 레시피를 인쇄합니다. 코딩 에이전트가 이를 적용합니다." summary="agent-native은 Markdown 청사진을 stdout으로 내보냅니다(stderr에 대한 진단). 전체 컨텍스트로 라이브 저장소를 편집하는 Claude Code 또는 Codex로 파이프합니다."
{
  "html": "<div class=\"diagram-bp\"><div class=\"diagram-node\" data-rough>agent-native add<br><small class=\"diagram-muted\">&lt;kind&gt; &lt;name|URL&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Markdown 블루프린트<br><small class=\"diagram-muted\">stdout · 수정할 파일 · 규칙 · 검증</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>코딩 에이전트<br><small class=\"diagram-muted\">claude · codex</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">edits your live repo</div></div>",
  "css": ".diagram-bp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bp .diagram-arrow{font-size:22px;line-height:1}.diagram-bp .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 용법 {#usage}

```bash
agent-native add <kind> <name>            # print a curated blueprint
agent-native add <kind> <https://docs…>   # URL에서 연구 및 통합
agent-native add --list                   # list available kinds and blueprints
```

- 단순한 **이름**은 `blueprints/<kind>/<name>.md`에서 선별된 청사진을 해결합니다.
- 이름 대신 **URL**는 URL가 연구 시작점으로 포함된 해당 종류에 대한 일반적인 _연구 및 통합_ 청사진을 내보냅니다(URL는 알려진 레시피가 아니라 연구 시드입니다).
- 청사진은 **stdout**으로 이동합니다. 진단은 stderr로 이동하므로 `… | claude`는 청사진만 수신합니다.

## 시드된 청사진 {#seeded}

`agent-native add --list`는 상자에 무엇이 들어 있는지 보여줍니다:

| 친절       | 이름      | 설정 내용                                                                          |
| ---------- | --------- | ---------------------------------------------------------------------------------- |
| `provider` | `stripe`  | 공급자를 `provider-api` 기판(카탈로그/문서/요청 트리오)에 연결합니다.              |
| `channel`  | `discord` | `PlatformAdapter` 인바운드 웹훅 채널을 구현하고 등록하세요.                        |
| `sandbox`  | `docker`  | Docker 컨테이너에서 `run-code`를 실행하려면 `SandboxAdapter` 솔기를 구현하세요.    |
| `action`   | `crud`    | Zod 스키마가 있는 단일 다중 표면 `defineAction`를 추가합니다(N에 하나의 `update`). |

각 청사진은 독립적입니다. 청사진을 읽는 코딩 에이전트는 파일을 가져오고, 프레임워크 규칙을 준수해야 합니다(actions는 단일 정보 소스이며, 비밀을 하드코딩하지 않으며, 소유할 수 있는 데이터 범위를 지정하고, `packages/*` 소스에 대한 변경 세트를 추가합니다). 구체적인 **확인** 섹션이 있습니다.

## URL → 연구 청사진 {#url}

URL를 전달하는 경우 해당 종류에 선별된 레시피가 없거나 새로운 통합을 원할 경우 `add`는 URL를 시드로 사용하여 일반적인 "연구 및 통합" 청사진을 내보냅니다.

```bash
agent-native add provider https://docs.example.com/api | claude
```

생성된 청사진은 코딩 에이전트에게 실제 엔드포인트, 인증 모델, 페이로드 형태 및 서명/검증 요구 사항에 대한 URL(및 링크된 페이지)를 가져온 다음(훈련 데이터에서 추측하지 _않음_) 구현하고 확인하도록 지시합니다. 또한 종류별 안내도 제공합니다(예: `provider` URL는 `provider-api` 기판 쪽으로 조종되고, `channel` URL는 `PlatformAdapter` 쪽으로 향합니다).

## 나만의 청사진 추가 {#authoring}

Markdown 파일을 `packages/core/blueprints/<kind>/<name>.md`에 놓습니다. 종류는 하위 디렉터리입니다. 이름은 `.md`가 없는 파일 이름입니다. 자동으로 선택됩니다. `--list`, 이름 확인 및 카탈로그는 모두 런타임 시 디렉터리를 읽습니다. 등록을 위해 코드 변경이 필요하지 않습니다.

청사진 `.md` 파일은 `package.json` `files`의 `blueprints` 항목을 통해 게시된 패키지에 제공되므로 최종 사용자를 위해 `node_modules/@agent-native/core/blueprints/**`에서 확인됩니다.

각 청사진을 다른 컨텍스트 없이 코딩 에이전트에 대한 명령 세트로 작성합니다. 좋은 청사진은 다음과 같습니다:

1. **한 줄 목표** 및 "당신은 에이전트 네이티브 앱의 코딩 에이전트입니다. 이를 실제 소스 변경 사항으로 적용하십시오" 프레이밍
2. **먼저 읽으십시오** — 계약서에 해당하는 정확한 파일을 읽어보세요.
3. **만질 파일** — 구체적인 경로와 각 변경 사항이 수행하는 작업.
4. **준수해야 할 프레임워크 규칙** — actions 우선, 하드코딩된 비밀 없음, 소유 가능한 데이터 범위, 게시 가능한 패키지 소스에 대한 변경 세트 추가.
5. **검증** — 유형 검사, 집중된 `*.spec.ts` 및 엔드 투 엔드 검사.

> [!TIP]
> 기존 종류에 따라 새로 선별된 청사진에는 코드가 필요하지 않습니다. 하지만 새로운 종류 디렉토리를 생성하면 해당 종류가 `--list`에도 자동으로 표시됩니다.

## 다음 단계

- [**Sandbox Adapters**](/docs/sandbox-adapters) — `add sandbox docker` 청사진이 대상으로 하는 이음새
- [**Actions**](/docs/actions) — 모든 청사진의 기반이 되는 단일 정보 소스
- [**External Agents**](/docs/external-agents) — 청사진을 파이프하는 코딩 에이전트 연결
