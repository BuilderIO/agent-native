---
title: "분석"
description: "평이한 영어로 분석 질문을 하고 차트와 대시보드를 다시 받아보세요. Amplitude, Mixpanel 및 Looker를 대체하는 오픈 소스입니다."
---

# 분석

평이한 영어로 분석 질문을 하고 차트와 대시보드를 다시 받아보세요. 에이전트는 BigQuery, GA4, Amplitude, 내장된 자사 이벤트 수집기, HubSpot, Jira 및 기타 12개 소스에 연결하여 쿼리를 작성하고 검증한 후 답변을 차트, 테이블 또는 저장된 대시보드 패널로 렌더링합니다.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:500px;box-sizing:border-box'><h1 style='margin:0'>Agent-Native 템플릿</h1><p class='wf-muted' style='margin:0'>지난 12주간의 도입과 참여도.</p><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card'><small class='wf-muted'>주간 활성 사용자</small><br/><strong>24,318</strong><br/><span class='wf-pill accent'>+12.4%</span></div><div class='wf-card'><small class='wf-muted'>신규 가입</small><br/><strong>1,842</strong><br/><span class='wf-pill accent'>+8.7%</span></div><div class='wf-card'><small class='wf-muted'>MRR 매출</small><br/><strong>$48,210</strong><br/><span class='wf-pill accent'>+21.3%</span></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1'><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>주간 활성 사용자</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:38%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:44%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:58%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:74%;flex:1;background:var(--wf-accent-soft)'></div></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>시간에 따른 매출</strong><div style='flex:1;display:flex;align-items:end;gap:8px'><div style='height:32%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:48%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:63%;flex:1;background:var(--wf-accent-soft)'></div><div style='height:80%;flex:1;background:var(--wf-accent-soft)'></div></div></div></div><div class='wf-card'><strong>소스별 가입</strong><br/><small class='wf-muted'>아래 차트는 기본 차트 아래에서 시작됩니다.</small></div></div>"
}
```

코드, 쿼리 및 데이터를 소유하려는 팀을 위한 Amplitude, Mixpanel 및 Looker를 대체하는 오픈 소스입니다.

```an-diagram title="차트에 대한 질문" summary="에이전트는 데이터 사전을 참조하고 SQL을 작성하고 웨어하우스에 대해 유효성을 확인한 다음 차트를 렌더링하거나 패널을 저장합니다."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">쉬운 설명<br>question</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">reads data dictionary</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL 쓰기</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">Dry-run 검증</div><small class=\"diagram-muted\">BigQuery / 소스</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">차트, 표 또는<br>saved panel</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 그것으로 무엇을 할 수 있나요

- **쉬운 영어로 데이터 질문을 하세요.** "지난달 가입 중 몇 퍼센트가 유료로 전환되었습니까?" 또는 "지난 6개월 동안의 주간 활성 사용자를 보여주세요." 에이전트는 올바른 소스를 선택하고 SQL를 작성한 후 차트를 렌더링합니다.
- **필터, 저장된 보기 및 매개변수 쿼리를 사용하여 재사용 가능한 SQL 대시보드**를 구축하세요.
- **여러 데이터 소스를 상호 참조하는 임시 분석을 실행**합니다. 원래 질문, 지침 및 결과와 함께 다시 실행 가능한 조사로 저장됩니다.
- **메트릭, 테이블 및 SQL 레시피의 살아있는 데이터 사전**을 유지 관리하여 에이전트가 매번 올바른 열 이름을 사용할 수 있도록 합니다(실제로 `hs_is_closed`일 때 더 이상 `is_closed`를 추측하지 않음).
- 팀과 **대시보드 공유** - 기본적으로 비공개이며 사용자별 또는 조직별로 뷰어/편집자/관리자 역할로 공유 가능합니다.
- **BigQuery, GA4, Mixpanel, Amplitude, PostHog, HubSpot, Jira, Apollo, Pylon, Gong, Common Room, Twitter 및 앱별 SEO 소스 등 다양한 소스에 바로 연결 가능**
- **워크스페이스 통합 재사용** 작업공간이 이미 연결되어 있는 경우
  Analytics에 공급자를 부여했습니다. 공유 통합 저장소 제공자
  신원 및 자격 증명 참조; Analytics는 앱별 소스 선택을 유지합니다.
  데이터 사전 항목, 대시보드 SQL 및 분석 기록.

## 시작하기

라이브 데모: [analytics.agent-native.com](https://analytics.agent-native.com).

처음 앱을 열 때:

1. Google로 로그인하세요.
2. 사이드바에서 **데이터 소스** 페이지를 엽니다.
3. 각 소스에는 둘러보기가 있습니다. 필요한 소스를 연결하세요(BigQuery, GA4, Amplitude 또는 자사 추적과 같은 소스부터 시작하세요).
4. 상담원과 새 채팅을 열고 "지난 주에 몇 건의 가입이 이루어졌나요?"라고 질문하세요.

첫 번째 질문으로 연결이 제대로 작동하는지 확인할 수 있습니다. 그런 다음 상담원에게 "이것을 대시보드로 저장"하거나 "주요 측정항목에 대한 4패널 개요 대시보드를 구축"하라고 요청하세요.

### 유용한 메시지

- "지난 6개월 동안의 주간 활성 사용자를 표시하는 대시보드를 구축하세요."
- "지난달 가입 중 몇 퍼센트가 유료로 전환되었습니까?"
- "이 대시보드에 계획별 수익을 비교하는 차트를 추가하세요."
- "MRR 측정항목이 먼저 나오도록 이 대시보드의 패널 순서를 변경하세요."
- "1분기의 종료되고 손실된 거래를 분석하고 분석 내용을 저장합니다."
- "이달의 데이터로 이탈 분석을 다시 실행합니다."
- "이 측정항목을 데이터 사전에 문서화하세요."

에이전트는 현재 대시보드, 필터, 보기 등 사용자가 무엇을 보고 있는지 항상 알고 있으므로 명시적으로 말하지 않고도 "이 대시보드" 또는 "저 패널"이라고 말할 수 있습니다.

## 알아야 할 세 가지 사항

앱에는 시간을 보낼 수 있는 세 가지 주요 표면이 있습니다.

- **SQL 대시보드** — 필터와 저장된 보기가 포함된 재사용 가능한 패널입니다. 정기적으로 확인하는 측정항목에 가장 적합합니다.
- **임시 분석** — 재실행 지침이 함께 저장된 여러 소스에서 가져온 장문의 조사입니다. 다시 확인하고 싶은 일회성 질문에 가장 적합합니다.
- **데이터 사전** — 측정항목, 테이블, 열 및 SQL 레시피의 표준 카탈로그입니다. 에이전트는 SQL를 작성하기 전에 이를 참조하므로 실제 웨어하우스 열 이름을 사용하고 "내부 이메일 제외"와 같은 주의 사항을 알고 있습니다.

사전은 에이전트에게 "dbt 정의 가져오기" 또는 "Notion 핸드북에서 측정항목 가져오기"를 요청하여 시드되며 작업을 수행합니다.

## 개발자용

이 문서의 나머지 부분은 Analytics 템플릿을 포크하거나 확장하는 모든 사람을 위한 것입니다.

### 빠른 시작

CLI에서 새 Analytics 앱 만들기:

```bash
npx @agent-native/core@latest create my-analytics --standalone --template analytics
```

로컬 개발자:

```bash
cd my-analytics
pnpm install
pnpm dev
```

CLI는 로컬 개발자 URL를 인쇄합니다. Google에 로그인한 다음 **데이터 소스** 페이지를 열어 BigQuery, GA4, 자사 추적, HubSpot, Jira 등을 연결하세요.

### 주요 기능

**질문하고 차트를 받으세요.** 에이전트는 데이터 소스를 선택하고 SQL를 작성 및 확인한 다음 차트, 표, 측정항목 또는 저장된 패널을 렌더링합니다.

**대시보드 및 조사.** 재사용 가능한 대시보드는 SQL 패널, 필터, 저장된 보기 및 공유를 유지합니다. 임시 분석은 재실행 지침을 통해 더 긴 결과를 저장합니다.

**실시간 데이터 사전.** 측정항목 정의, 소유자, 소스 테이블 및 알려진 주의 사항은 에이전트가 쿼리를 작성하기 전에 실제 웨어하우스 어휘를 제공합니다.

**광범위한 커넥터 표면.** BigQuery, GA4, 제품 분석, CRM, 지원, 커뮤니티, GitHub/Jira, SEO 및 자사 `/track` 이벤트는 모두 에이전트가 호출할 수 있는 actions를 통해 제공됩니다.

### 에이전트와 협력하기

에이전트는 항상 귀하가 무엇을 보고 있는지 알고 있습니다. 현재 화면 상태는 모든 메시지에 `<current-screen>` 블록으로 삽입됩니다. 여기에는 활성 보기, 열려 있는 대시보드 또는 분석, 선택한 필터가 포함됩니다.

에이전트의 시스템 프롬프트는 활성 조직에 대해 승인된 메트릭 항목과 함께 삽입된 `<data-dictionary>` 블록을 가져옵니다. 대시보드를 요청하면 상담원은 먼저 사전을 참조하고 문서화된 `table` / `columns` / `queryTemplate` 축어를 사용하며 열 이름을 추측하지 않습니다.

**자동으로 포함되는 컨텍스트:**

- **현재 보기** — `overview`, `adhoc`(`dashboardId` 포함), `analyses`(`analysisId` 포함), `data-dictionary`, `data-sources` 또는 `settings`.
- **활성 조직** — 모든 쿼리 및 쓰기 범위를 지정합니다.
- **승인된 사전 항목** — 활성 작업공간용.

**대시보드 편집.** 에이전트는 `update-dashboard` 작업을 사용하여 대시보드를 편집합니다. 두 가지 모드를 지원합니다:

- `ops` — 수술 편집을 위한 JSON-포인터 패치(패널 이동, SQL 문자열 하나 교체, 필터 제거).
- `config` — 대시보드 구성을 완전히 교체했습니다.

모든 BigQuery 패널의 SQL는 대시보드가 저장되기 전에 웨어하우스에 대해 테스트 실행됩니다. 열이 잘못된 경우 BigQuery 오류로 인해 저장이 거부됩니다. 에이전트는 손상된 패널을 유지하는 대신 SQL를 수정하고 재시도합니다.

### 데이터 소스 연결

**데이터 소스** 페이지(`/data-sources`)를 열어 공급자를 연결하세요. 각각
소스는 env-key 목록, 연습 및 **연결 테스트** 버튼을 노출합니다.
분석이 작업 공간에서 실행되면 `data-source-status`도 보고합니다
`appId=analytics`에 재사용 가능한 작업 공간 연결을 부여하여 에이전트가 다음 작업을 수행할 수 있게 했습니다.
동일한 공급자 키의 다른 사본 대신 앱 부여를 요청하세요.
Slack, HubSpot, Notion 및 GitHub와 같은 재사용 가능한 공급자의 경우 데이터
소스 UI는 공유 통합 상태를 직접 보여줍니다: 작업 공간을 통해 준비됨,
허가 필요, 자격 증명 또는 로컬 자격 증명이 필요합니다.

재사용 가능한 작업 공간 통합은 공유 공급자의 런타임 방향입니다.
프레임워크는 공급자 ID, 계정 메타데이터, 자격 증명 참조 및
앱당 한 번만 부여됩니다. Analytics는 데이터 소스 해석, 소스를 저장합니다.
진실 선택, 지표 정의, 대시보드 및 분석

자격 증명은 프레임워크의 설정/환경 계층을 통해 저장됩니다. git에는 비밀이 없습니다. 제작 요구사항:

| 변수                                     | 목적                                        |
| ---------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`                           | 지속적인 SQL 연결 URL                       |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | 인증                                        |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `_SECRET`   | 기본 Google 로그인 클라이언트(OAuth 2.0)    |
| `GOOGLE_CLIENT_ID` / `_SECRET`           | 기존 로그인 대체/Google API 통합 클라이언트 |
| `BIGQUERY_PROJECT_ID`                    | BigQuery 프로젝트                           |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON`    | BigQuery 서비스 계정 JSON                   |
| `ANTHROPIC_API_KEY`                      | 에이전트 채팅                               |

공급자별 키(HubSpot, Jira, Gong, Pylon 등)는 데이터 소스 페이지의 각 소스 연습에 문서화되어 있습니다. API 키가 필요한 새 작업을 추가하면 템플릿의 온보딩 등록을 통해 해당 페이지에 새 소스로 나타납니다.

참고: Google 로그인을 위한 BigQuery OAuth 사용자 인증 정보는 **별도**입니다.
BigQuery 서비스 계정 JSON의 사용자 인증 정보입니다.
GCP 콘솔 → APIs & 서비스 → 자격 증명 → OAuth 클라이언트 ID, 선호
`GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` 환경 이름은 이렇습니다
낮은 범위의 로그인 클라이언트는 Google API 통합 클라이언트와 별도로 유지됩니다.

### 데이터 모델

핵심 테이블(`templates/analytics/server/db/schema.ts` 참조):

```an-schema title="분석 데이터 모델" summary="Dashboards and analyses are the resources; views, shares, and a query cache hang off them. Org tables come from @agent-native/core/org."
{
  "entities": [
    {
      "id": "dashboards",
      "name": "dashboards",
      "note": "탐색기 및 SQL 대시보드",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "kind", "type": "text", "note": "\"explorer\" or \"sql\"" },
        { "name": "config", "type": "text", "note": "JSON 일치 SqlDashboardConfig" }
      ]
    },
    {
      "id": "dashboard_views",
      "name": "dashboard_views",
      "note": "대시보드당 저장된 필터 사전 설정",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "dashboard_id", "type": "text", "fk": "dashboards.id" }
      ]
    },
    {
      "id": "analyses",
      "name": "analyses",
      "note": "재실행 가능한 임시 조사",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "question", "type": "text" },
        { "name": "instructions", "type": "text", "note": "단계 다시 실행" },
        { "name": "dataSources", "type": "text", "note": "터치한 소스" },
        { "name": "resultMarkdown", "type": "text" },
        { "name": "resultData", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "bigquery_cache",
      "name": "bigquery_cache",
      "note": "SQL 해시로 키가 지정된 결과 캐시",
      "fields": [
        { "name": "sql_hash", "type": "text", "pk": true },
        { "name": "bytes_processed", "type": "integer" }
      ]
    }
  ],
  "relations": [
    { "from": "dashboards", "to": "dashboard_views", "kind": "1-n", "label": "saved views" }
  ]
}
```

또한 `@agent-native/core/org`에서 제공하는 리소스별 공유 테이블(`dashboard_shares`, `analysis_shares`) 및 조직 테이블(`organizations`, `org_members`, `org_invitations`)도 있습니다. 데이터 사전은 범위가 지정된 키 아래 프레임워크의 `settings` 테이블에 있습니다.

- **`dashboards`** — Explorer 및 SQL 대시보드 모두. `kind`는 `"explorer"` 또는 `"sql"`이고; `config`는 `SqlDashboardConfig`와 일치하는 JSON 얼룩입니다.
- **`dashboard_shares`** — 리소스별 공유 부여(주체, 역할).
- **`dashboard_views`** — 대시보드당 저장된 필터 사전 설정.
- **`analyses`** — `question`, `instructions`, `dataSources`, `resultMarkdown` 및 선택적 `resultData`를 사용한 임시 조사.
- **`analysis_shares`** — 분석을 위한 리소스별 공유 부여.
- **`bigquery_cache`** — 바이트 처리 계정을 사용하여 SQL 해시로 입력된 쿼리 결과 캐시.

또한 `@agent-native/core/org`에서 제공하는 조직 테이블(`organizations`, `org_members`, `org_invitations`)도 있습니다.

데이터 사전은 범위가 지정된 키 아래 프레임워크의 `settings` 테이블에 있습니다. 전체 모양은 `list-data-dictionary` 및 `save-data-dictionary-entry` actions를 참조하세요.

### 사용자 정의

Analytics 템플릿은 분기 및 확장을 위한 것입니다. 모든 것은 `templates/analytics/`에 있습니다:

- **`AGENTS.md`** — 상담원의 최상위 가이드입니다. 문서 보기, actions 및 작업 흐름.
- **`actions/`** — 모든 에이전트 호출 가능 작업. 새 작업을 추가하려면 새 파일을 추가하세요. 주목할만한 것:
  - `update-dashboard.ts` — 대시보드 편집(ops + 전체 교체)
  - `save-analysis.ts` / `list-analyses.ts` — 임시 분석
  - `save-data-dictionary-entry.ts` / `list-data-dictionary.ts` — 사전
  - `bigquery.ts` — 원시 BigQuery 실행
  - `view-screen.ts` / `navigate.ts` — 상황 인식
- **`app/routes/`** — 파일 기반 경로. 각 경로는 `app/pages/`의 페이지를 둘러싸는 얇은 래퍼입니다.
- **`app/pages/adhoc/sql-dashboard/`** — SQL 대시보드 렌더러, 패널 편집기, 필터 표시줄, 저장된 보기.
- **`app/pages/analyses/`** — 목록 및 세부정보 보기를 분석합니다.
- **`app/pages/DataSources.tsx`** — UI를 온보딩하는 데이터 소스.
- **`app/pages/DataDictionary.tsx`** — 사전 브라우저 및 편집기.
- **`.agents/skills/`** — 요청 시 에이전트가 읽는 패턴 가이드:
  - `dashboard-management` — 저장 공간, 범위 해상도, 대시보드 구성 형태
  - `data-querying` — 접근할 스크립트, 필터링 패턴
  - `adhoc-analysis` — 소스 간 조사를 위한 워크플로
  - `data-querying`, `real-time-sync`, `frontend-design`, `storing-data`, `self-modifying-code`
- **`.builder/skills/<provider>/SKILL.md`** — 제공업체별 문제(BigQuery, HubSpot, Jira, GA4 등). 쿼리하기 전에 읽어보세요. 새로운 것을 배우면 업데이트하세요.
- **`server/db/schema.ts`** — 대시보드, 공유, 보기, 분석, BigQuery 캐시를 위한 Drizzle 스키마
- **`server/lib/dashboards-store.ts`** — 범위 확인 및 레거시 KV 마이그레이션을 포함한 대시보드 읽기/쓰기.
- **`server/lib/bigquery.ts`** — BigQuery 클라이언트, 테스트 실행 유효성 검사기, 캐시 로직.

새 데이터 소스를 추가하려면 공급자를 호출하고 `output()` 도우미를 통해 결과를 반환하는 스크립트를 `actions/`에 놓습니다. 에이전트가 즉시 사용할 수 있게 되며 대시보드 패널 내에서 사용할 수 있습니다(서버 핸들러를 통해 결과를 노출하는 경우).

새 차트 유형을 추가하려면 `app/pages/adhoc/sql-dashboard/types.ts`에서 `ChartType` 통합을 확장하고 `SqlChartCard.tsx`에서 처리하면 에이전트가 모든 패널에서 사용할 수 있습니다.

템플릿 확장에 대한 더 넓은 패턴을 보려면 [Skills guide](/docs/skills-guide) 및 [Actions](/docs/actions)를 참조하세요.
