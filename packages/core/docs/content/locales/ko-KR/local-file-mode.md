---
title: "로컬 파일 모드"
description: "로컬 Markdown, MDX 및 기타 repo 파일을 정보 소스로 사용하여 에이전트 네이티브 앱을 실행합니다. 여기에는 맞춤 구성요소가 포함된 Obsidian 스타일 MDX 문서도 포함됩니다."
---

# 로컬 파일 모드

로컬 파일 모드를 사용하면 에이전트 네이티브 앱이 일반 UI 및 작업 표면을 연결할 수 있습니다.
저장소나 작업공간의 파일에 직접 연결됩니다. 앱이 여전히 호스팅된 것처럼 느껴집니다.
제품, 목록 보기, 편집기 및 에이전트 도구는 로컬 파일을 읽고 씁니다
SQL 지원 앱 기록 대신

첫 번째 구현은 콘텐츠 템플릿에 있습니다. 왼쪽 사이드바는 다음과 같습니다.
로컬 `.md` 및 `.mdx` 파일로 채워지며, 페이지를 선택하면 표준이 열립니다.
컨텐츠 편집기 및 저장하면 선택한 파일에 다시 기록됩니다. 동일한 파일은 다음과 같습니다.
Codex, Claude 코드, Agent-Native 사이드바 에이전트 또는 일반 사용자로도 편집 가능
편집자.

콘텐츠의 경우 제품이 MDX용 오픈 소스 Obsidian처럼 느껴집니다.
문서는 파일로 저장되고 앱에는 시각적 편집기인 에이전트 actions가 추가됩니다.
공유 가능한 복사본 및 풍부한 대화형 MDX 구성 요소

저장소 우선 워크플로를 원할 경우 로컬 파일 모드를 사용하세요.

- `docs/*.mdx`를 사용한 문서 저장소
- `blog/*.mdx`가 있는 블로그
- `resources/*.md`의 포지셔닝, 메시지 또는 팀 메모와 같은 리소스
- 풍부한 MDX 편집기를 갖춘 개인 흑요석 스타일 지식 기반
- 로컬 React 코드에서 생성된 대화형 사용자 정의 MDX 블록이 필요한 문서
- 코딩 에이전트가 쉽게 검사하고 패치할 수 있는 앱 아티팩트

호스팅된 협업 앱 경험을 원할 때 데이터베이스 모드를 사용하세요:
다중 사용자 공유, SQL 지원 권한, 댓글, 버전 기록 및
로컬 파일 시스템 액세스가 없는 프로덕션 호스팅

## 정신 모델

두 가지 정보 소스 모드가 있습니다:

| 모드              | 진실의 근원                            | 최적의 용도                                                        |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------ |
| 데이터베이스 모드 | Drizzle를 통한 SQL 행                  | 호스팅된 앱, 공동 작업, 공유, 댓글, 버전 기록                      |
| 로컬 파일 모드    | `agent-native.json`가 선언한 Repo 파일 | 로컬/개발 워크플로, Git 검토, 코딩 에이전트 편집, 파일 기본 콘텐츠 |

UI와 에이전트 actions는 두 모드 모두에서 동일한 모양을 유지해야 합니다. 내용
편집자는 여전히 문서를 편집합니다. 차이점은 해당 문서가 해결되는지 여부입니다.
SQL 행 또는 로컬 파일

```an-diagram title="동일한 행동, 두 가지 진실 소스" summary="UI와 에이전트는 두 모드에서 동일한 작업을 호출합니다. 작업 계층은 각 호출이 SQL 행 또는 repo 파일로 확인되는지 여부를 결정합니다."
{
  "html": "<div class=\"diagram-mode\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">콘텐츠 UI</div><div class=\"diagram-node\">에이전트 + actions<br><small class=\"diagram-muted\">list/get/update-document</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-row resolve\"><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill accent\">데이터베이스 모드</span><small class=\"diagram-muted\">SQL rows via Drizzle</small><small class=\"diagram-muted\">호스팅 · 공유 · 댓글 · 기록</small></div><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill ok\">Local File Mode</span><small class=\"diagram-muted\">repo files via agent-native.json</small><small class=\"diagram-muted\">Git 리뷰 · 코딩 에이전트 편집</small></div></div></div>",
  "css": ".diagram-mode{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mode .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mode .diagram-arrow{font-size:22px;line-height:1}.diagram-mode .resolve{display:flex;gap:12px;flex-wrap:wrap}.diagram-mode .diagram-panel{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

## 예시 저장소

콘텐츠 작업공간은 다음과 같이 작을 수 있습니다:

```an-file-tree title="Content workspace repo"
{
  "entries": [
    { "path": "agent-native.json", "note": "어떤 폴더가 콘텐츠 루트인지와 그 종류를 선언" },
    { "path": "docs/", "note": "콘텐츠 루트: 사이드바에 페이지로 표시" },
    { "path": "docs/getting-started.mdx" },
    { "path": "docs/guides/custom-components.mdx" },
    { "path": "blog/", "note": "콘텐츠 루트" },
    { "path": "blog/launch-post.mdx" },
    { "path": "resources/", "note": "콘텐츠 루트" },
    { "path": "resources/messaging/positioning.md" },
    { "path": "components/", "note": "콘텐츠 루트 아님: MDX가 import할 수 있는 preview 컴포넌트 라이브러리" },
    { "path": "components/FrameworkTabs.tsx" },
    { "path": "components/Callout.tsx" },
    { "path": "extensions/", "note": "콘텐츠 루트 아님: 로컬 extension 라이브러리(sandboxed widgets)" },
    { "path": "extensions/doc-status/extension.json" },
    { "path": "extensions/doc-status/index.html" }
  ]
}
```

로컬 파일 모드에서 콘텐츠 사이드바에는 `docs/`, `blog/` 및
`resources/` 트리를 페이지로 표시합니다. `docs/getting-started.mdx`를 선택하면 다음이 열립니다.
표준 컨텐츠 편집기의 파일; UI에서 편집하면
`docs/getting-started.mdx`.

`components/`는 콘텐츠 루트가 아닙니다. MDX가 제공하는 미리보기 구성요소 라이브러리입니다
파일을 가져오거나 참조할 수 있습니다. 편집기는 간단한 로컬 MDX 구성요소를 렌더링할 수 있습니다
전체 콘텐츠 앱을 복제하거나 포크할 필요가 없습니다.

`extensions/`도 콘텐츠 루트가 아닙니다. 로컬 확장 라이브러리입니다:
소스가 그대로 유지되는 동안 앱 슬롯에서 렌더링할 수 있는 작은 샌드박스 위젯
저장소.

## 저장소에 콘텐츠 설치

기존 문서, 블로그 또는 MDX 작업공간의 경우 콘텐츠 로컬 파일을 설치하세요.
스킬:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

`content` 스킬을 저장소의 에이전트 스킬 폴더에 복사하고 씁니다.
또는 콘텐츠 기본값으로 `agent-native.json`를 업데이트합니다.

- 작업 공간 수준의 `mode: "local-files"`
- `apps.content.mode: "local-files"`
- `docs/`, `blog/`, `content/` 및 `resources/`의 콘텐츠 루트
- 로컬 MDX 구성요소용 `components/`
- 로컬 확장 위젯용 `extensions/`

설치된 스킬은 코딩 에이전트에게 콘텐츠 actions를 사용하도록 지시합니다
(`list-documents`, `get-document`, `edit-document`, `update-document`,
`share-local-file-document` 및 구성 요소 파일 actions)(로컬 콘텐츠 앱인 경우)
또는 Agent Native 데스크탑 브리지가 이를 노출합니다. 다리가 달리고 있지 않으면 스킬
머리말, 가져오기, JSX를 보존하면서 안전한 직접 저장소 편집으로 대체
그리고 알 수 없는 MDX.

## 구성

저장소 또는 작업공간 루트에 `agent-native.json`를 추가하세요.

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

`AGENT_NATIVE_MODE=local-files` 또는
`AGENT_NATIVE_DATA_MODE=local-files`; 매니페스트가 선호되는 이유는
저장소 자체에 폴더 계약을 문서화합니다.

## 콘텐츠 파일 형식

콘텐츠는 Markdown 및 MDX를 읽습니다. Frontmatter는 페이지 메타데이터를 담고 있으며 본문은
편집 가능한 문서:

```mdx
---
title: "시작하기"
icon: "sparkles"
isFavorite: true
updatedAt: "2026-06-12T20:00:00.000Z"
---

# 시작하기

Use <FrameworkTabs value="react" /> to show framework-specific code.
```

제목은 `title` 머리말에서 나오며, 그렇지 않으면
파일 이름. 편집기는 아직 시각적으로 편집할 수 없는 MDX 소스를 보존하므로
코딩 에이전트와 일반 텍스트 편집기는 안전한 탈출구로 남아 있습니다.

## 사용자 정의 MDX 구성 요소

콘텐츠는 구성된 `components` 폴더에서 로컬 구성 요소를 미리 볼 수 있습니다.
이는 탭, 콜아웃, 패키지와 같은 문서 스타일 MDX 구성요소를 위한 것입니다.
스니펫 또는 프레임워크별 코드 블록을 설치합니다.

예를 들어 콘텐츠 옆에 대화형 구성요소를 추가하세요.

```tsx
// components/ImpactCounter.tsx
import { useState } from "react";

export function ImpactCounter({
  label = "points",
  accent = "blue",
  featured = false,
}: {
  label?: string;
  accent?: "blue" | "green" | "purple";
  featured?: boolean;
}) {
  const [count, setCount] = useState(3);
  const accentClass =
    accent === "green"
      ? "border-green-300 bg-green-50"
      : accent === "purple"
        ? "border-purple-300 bg-purple-50"
        : "border-blue-300 bg-blue-50";

  return (
    <div className={`rounded-md border p-4 ${accentClass}`}>
      <div className="text-sm text-muted-foreground">Launch impact</div>
      <div className="mt-1 text-3xl font-semibold">
        {count} {label}
      </div>
      {featured ? <div className="mt-1 text-sm">Featured metric</div> : null}
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm"
        onClick={() => setCount((value) => value + 1)}
      >
        Add point
      </button>
    </div>
  );
}

export const ImpactCounterInputs = {
  label: {
    type: "string",
    label: "Metric label",
    default: "points",
  },
  accent: {
    type: "select",
    label: "Accent",
    options: ["blue", "green", "purple"],
    default: "blue",
  },
  featured: {
    type: "boolean",
    label: "Featured",
    default: false,
  },
};
```

그런 다음 로컬 MDX 파일에서 사용하십시오.

```mdx
---
title: "출시 노트"
---

# 출시 노트

<ImpactCounter label="wins" />
```

콘텐츠 개발 서버는 내보내기 및 PascalCase 기본값이라는 PascalCase를 검색합니다.
`components/` 아래의 `.tsx`, `.jsx`, `.ts` 및 `.js` 파일에서 내보냅니다. 그
구성요소는 편집기 내에서 렌더링되고 아래의 슬래시 메뉴에 나타납니다
**로컬 구성요소**. 슬래시를 삽입하면 다음과 같은 최소한의 태그가 생성됩니다.
`<ImpactCounter />`; 필요한 경우 MDX 소스에 소품을 추가하세요.

구성요소 실행은 의도적으로 로컬 개발/데스크톱 브리지 기능이 아닌
일반 호스팅 브라우저 폴더 액세스. `content.agent-native.com`를 열면
**로컬 파일**을 선택하고 Chrome에서 폴더를 선택하면 앱이 읽고 쓸 수 있습니다.
`.md` 및 `.mdx` 파일은 브라우저 파일 시스템 액세스 API를 통해 이루어지지만
Chrome은 컴파일할 Vite의 절대 폴더 경로를 노출하지 않습니다.
`components/*.tsx`. 사용자 정의 React 구성 요소를 미리 보고 핫 리로드하려면 다음을 실행하세요.
신뢰할 수 있는 로컬 브리지에서 콘텐츠를 로컬로 전송하거나 Agent Native 데스크탑을 사용하여
선택한 작업공간을 로컬 컨텐츠 개발 서버에 등록합니다. 해당 모드에서는
Vite를 통해 기존 구성 요소 파일 핫 리로드를 편집하고 또는 추가
구성요소 파일을 제거하면 구성요소 레지스트리와 슬래시 메뉴가 다시 로드됩니다.

에이전트는 등록된 구성 요소 파일로 작업할 수도 있습니다. 사용
`list-local-component-files`를 사용하여 등록된 작업공간 ID를 찾은 다음
`write-local-component-file` - `.tsx`, `.jsx`, `.ts` 생성 또는 업데이트
작업 공간의 `components/` 폴더 아래에 있는 `.js` 파일. MDX 파일은 그대로 유지됩니다.
구성요소 사용에 대한 정보 소스. 구성 요소 파일은 일반 저장소로 유지됩니다.
Git로 검토한 소스 파일.

구성 요소가 입력 메타데이터를 내보내는 경우 편집기에서 구성 요소 선택
구성요소의 오른쪽 상단에 편집 버튼이 표시됩니다. 지원되는 입력 유형
`string`, `textarea`, `number`, `boolean` 및 `select`입니다. 양식은 다음과 같습니다.
MDX 태그로 다시 변경되므로 로컬 파일은 정보 소스로 유지됩니다.
메타데이터는 `ComponentNameInputs`, `ComponentNameConfig.inputs`로 내보낼 수 있습니다.
`Component.inputs` 또는 `agentNative.inputs`.

리터럴 소품이 있는 간단한 구성 요소 태그는 인라인으로 미리 볼 수 있습니다.

```mdx
<FrameworkTabs value="react" />

<Callout type="warning">This setting affects production deploys.</Callout>
```

복잡한 JSX 표현식은 소스에 보존됩니다. 편집자가 안전하게 할 수 없는 경우
아직 구성 요소 속성을 미리 보면
데이터를 자동으로 삭제합니다.

## 로컬 파일 공유

다른 사용자가 경로를 읽을 수 없기 때문에 로컬 파일은 직접 공유되지 않습니다.
당신의 기계. 콘텐츠 도구 모음의 공유 버튼은
선택한 파일의 데이터베이스 기반 복사본을 찾아 해당 복사본을 탐색하고
일반 공유 팝오버. 원본 로컬 파일은 로컬 파일 아래에 남아 있습니다.
데이터베이스 복사본은 로컬 파일 모드의 공유 복사본 아래에 나타나며
표준 문서 공유 모델.

## 지역 확장

로컬 파일 모드는 구성된 파일에서 repo 지원 확장을 로드할 수도 있습니다.
`extensions` 폴더. 각 확장은 `extension.json`가 포함된 하나의 디렉터리입니다.
매니페스트 및 HTML 항목 파일:

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

`index.html`는 일반에서 사용하는 것과 동일한 Alpine/Tailwind 확장 본문 형식입니다.
데이터베이스 지원 확장. 콘텐츠 앱이 다음과 같은 로컬 확장을 볼 때
`content.sidebar.bottom`를 선언하면 해당 확장을
the Content sidebar. The host passes `window.slotContext` with the selected
문서 ID, 제목, 소스 메타데이터 및 콘텐츠가 로컬 파일 모드에 있는지 여부

로컬 확장자는 앱에서 미리 볼 수 있지만 파일로 편집됩니다. 확장 프로그램
목록에는 로컬 파일 배지가 표시되며 전체 페이지 뷰어는 다음을 가리킵니다
항목 파일입니다. 업데이트, 삭제, 공유 및
이력은 적용되지 않습니다. 편집기, Codex, Claude 코드 또는 Git 기록을 사용하여
소스 변경.

v1의 경우 로컬 확장은 의도적으로 보수적입니다.

- 그들은 자신의 작은 런타임 상태를 위해 `extensionData`를 사용할 수 있습니다
- `extension.json`에 나열된 `appAction`만 호출할 수 있습니다
- 원시 SQL 도우미 및 외부 `extensionFetch`가 비활성화되었습니다.
- 슬롯 대상은 SQL를 통해 설치되지 않은 `extension.json`에서 선언되었습니다.

이것은 로컬 작업 공간에 Obsidian과 유사한 플러그인 표면을 제공하지만
임의의 repo 파일은 데이터베이스 지원 확장 프로그램의 모든 기능을 상속합니다.

## 앱이 이를 사용하는 방법

로컬 파일 모드는 프레임워크의 로컬 아티팩트 도우미를 통해 구현됩니다.
앱은 자신이 소유한 아티팩트 유형의 루트를 선언한 다음 읽고 씁니다.
UI와 에이전트가 이미 사용하고 있는 동일한 작업 표면을 통해

콘텐츠의 경우 다음을 의미합니다.

- `list-documents`에는 구성된 `.md` 및 `.mdx` 파일이 나열됩니다.
- `get-document`는 선택한 로컬 파일을 읽습니다.
- `update-document`는 선택한 로컬 파일을 씁니다.
- `create-document`는 선택한 폴더에 새 로컬 `.mdx` 파일을 생성합니다.
- `delete-document`는 로컬 파일을 삭제합니다.
- 검색은 구성된 로컬 파일 전체에서 실행됩니다.

컨텐츠 UI에서 로컬 파일 페이지를 이동하고, 이름을 바꾸고, 순서를 바꾸는 것은
아직 지원됩니다. 작업 공간이나 코딩 에이전트를 사용하여 해당 작업을 수행하십시오.
콘텐츠 사이드바에는 결과 파일 트리가 반영됩니다.

이렇게 하면 에이전트 계약이 단순해집니다. 에이전트는 콘텐츠 actions를 계속 사용할 수 있습니다.
그리고 actions는 대상이 SQL 지원인지 파일 지원인지 결정합니다.

시간이 지남에 따라 다른 앱도 동일한 패턴을 채택할 수 있습니다. 프레젠테이션 앱은 지도를 작성할 수 있습니다
`slides/*.mdx`를 데크에 연결하고 Plans 앱은 `plans/*`를 계획 문서에 매핑할 수 있으며
대시보드 앱은 `dashboards/*.mdx`를 대시보드에 매핑할 수 있습니다. 특정 앱
폴더는 동일한 로컬 아티팩트 계약 위에 쌓인 규칙입니다.

## 로컬 파일과 내보내기/가져오기

콘텐츠에는 두 가지 파일 작업 흐름이 있습니다:

| 워크플로우                       | 무슨 일이 일어나는지                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/local-files` 내보내기/가져오기 | 데이터베이스 모드는 여전히 정보의 원천입니다. 파일은 내보내고, 편집하고, 미리 보고, 가져오는 명시적인 동기화 표면입니다. |
| 로컬 파일 모드                   | 파일은 정보의 원천입니다. 콘텐츠 사이드바와 편집기는 로컬 파일에서 직접 작동합니다.                                      |

호스팅된 작업공간 주변에서 가끔 파일을 검토하려는 경우 내보내기/가져오기를 사용하세요.
저장소 자체가 작업공간인 경우 로컬 파일 모드를 사용하세요.

## 역사와 협력

로컬 파일 모드는 파일 기본 기록에 의존합니다:

- Git에 중요한 변경 사항을 커밋
- 검토를 위해 풀 요청 사용
- 코딩 에이전트가 동일한 파일을 직접 편집하도록 허용
- 변경사항을 이해하려면 일반 파일 비교를 사용하세요

데이터베이스 모드는 다음과 같은 호스팅 공동 작업 기능에 더 적합합니다.
공유, 댓글, SQL 지원 버전 기록 및 실시간 다중 사용자 편집

공급자 동기화는 두 모드 중 하나 위에 계층화될 수 있습니다. 예를 들어, 문서 저장소는
CMS의 콘텐츠를 로컬 MDX 파일로 가져오거나 선택한 항목을 푸시하는 actions를 추가하세요.
로컬 파일을 해당 CMS로 되돌립니다.

## 생산 안전

로컬 파일 모드는 앱 actions에 구성된 작업 공간에 대한 직접 쓰기 액세스를 제공합니다.
파일. 로컬 개발 및 신뢰할 수 있는 단일 테넌트 파일에 적합합니다.
브리지이지만 기본 프로덕션 보안 모델은 아닙니다.

`NODE_ENV=production`일 때, 프레임워크는 다음을 제외하고 `local-files` 모드를 거부합니다.
설정:

```bash
AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true
```

모든 사람이 사용할 수 있는 신뢰할 수 있는 단일 테넌트 배포에 대해서만 설정하십시오.
앱은 구성된 파일을 읽고 쓸 수 있습니다. 일반 호스팅의 경우
다중 사용자 앱, 데이터베이스 모드 및 SQL 지원 공유를 사용하세요.
