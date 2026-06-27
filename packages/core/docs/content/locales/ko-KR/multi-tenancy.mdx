---
title: "다중 테넌시"
description: "모든 에이전트 기반 앱은 구성이 필요 없는 조직, 팀 구성원, 역할, 조직별 데이터 격리 등 즉시 사용 가능한 멀티 테넌트입니다."
---

# 다중 테넌시

모든 에이전트 기반 앱은 기본적으로 다중 테넌트입니다. 조직, 팀 구성원, 역할 기반 액세스 및 조직별 데이터 격리가 구성 없이 프레임워크에 내장되어 있습니다.

## 무료로 얻는 것 {#free}

새로운 `npx @agent-native/core@latest create` 비계에는 이미 다음이 포함되어 있습니다:

- **사용자 등록 및 로그인** — [Authentication](/docs/authentication)를 참조하세요.
- **조직** — 사용자는 조직을 만들고 이메일로 구성원을 초대합니다. 각 조직은 완전히 격리된 테넌트입니다.
- **역할** — 모든 구성원은 `owner`, `admin` 또는 `member`입니다. actions는 인증을 위한 역할을 확인할 수 있습니다.
- **조직 전환** — 세션은 활성 조직(`session.orgId`)을 추적하고 이를 전환하면 사용자와 상담원이 보는 데이터가 변경됩니다.
- **조직별 데이터 격리** — 모든 쿼리는 자동으로 활성 조직으로 범위가 지정됩니다.

CRM, 프로젝트 추적기, 지원 받은 편지함 또는 모든 팀 도구에 대한 에이전트 기반을 평가하는 경우 다중 테넌트 기반이 이미 존재합니다. 모든 자사 템플릿은 다중 테넌트입니다. 목록은 [Cloneable SaaS templates](/docs/cloneable-saas)를 참조하세요.

```an-diagram title="조직 멤버십 및 격리" summary="사용자는 owner/admin/member로 조직에 가입합니다. 모든 소유 가능 행은 이를 소유한 테넌트의 org_id을 전달하며 경계를 넘어 누출되는 행은 없습니다."
{
  "html": "<div class=\"mt-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">조직 A</span><small class=\"diagram-muted\">members: alice (owner), bob (member)</small><div class=\"diagram-box\">rows where org_id = A</div></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">조직 B</span><small class=\"diagram-muted\">members: carol (owner)</small><div class=\"diagram-box\">rows where org_id = B</div></div></div><div class=\"mt-wall\" aria-hidden=\"true\"><span class=\"diagram-pill warn\">no cross-org reads</span></div>",
  "css": ".mt-grid{display:flex;gap:16px;flex-wrap:wrap}.mt-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;flex:1;min-width:200px}.mt-wall{display:flex;justify-content:center;margin-top:12px}"
}
```

## 조직 전환기 UI {#org-switcher}

조직 전환기와 회원 UI는 추가 코드 없이 모든 템플릿을 렌더링합니다. 이들은 `/_agent-native/org/*` 아래에서 핵심 조직 REST 경로를 구동합니다(조직 생성, 조직 전환, 구성원 목록/초대/제거, 역할 변경, 허용된 이메일 도메인 설정). 사용자는 전환기에서 활성 조직을 선택합니다. 회원 패널은 초대 및 역할 변경을 처리합니다.

이것은 Better Auth의 조직 플러그인(의도적으로 등록되지 않음)이 아닌 프레임워크 자체 `org/` 모듈입니다. 전체 조직 관리 표면(`createOrganization`, REST 경로 및 `invite-member`와 같은 템플릿 작성 `defineAction` 래퍼)은 [Authentication → Organizations](/docs/authentication#organizations)에 문서화되어 있습니다.

## 격리 작동 방식 {#isolation}

테넌트 데이터는 `org_id` 열(`ownableColumns()`에 의해 추가됨)로 격리되며 프레임워크는 모든 쿼리 범위를 자동으로 활성 조직(`session.orgId → AGENT_ORG_ID → SQL`)으로 지정합니다. 사용자가 조직을 전환하면 UI, actions 및 에이전트는 모두 해당 조직의 데이터만 볼 수 있습니다. 에이전트는 사용자가 구성원이 아닌 조직의 데이터에 접근할 수 없습니다.

```an-diagram title="세션에서 범위가 지정된 SQL까지" summary="세션의 활성 조직은 AGENT_ORG_ID가 되며, 프레임워크는 이를 모든 쿼리의 WHERE 절로 접습니다."
{
  "html": "<div class=\"mt-pipe\"><div class=\"diagram-node\">session.orgId<br><small class=\"diagram-muted\">active org on session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">AGENT_ORG_ID<br><small class=\"diagram-muted\">request context</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">SQL row scoping<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div></div>",
  "css": ".mt-pipe{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mt-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.mt-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

이것은 사용자별 범위 지정에 사용되는 것과 동일한 파이프라인입니다. SQL 수준 메커니즘, `ownableColumns()` 계약 및 `accessFilter` / `resolveAccess` / `assertAccess` 가드에 대해서는 범위 지정 파이프라인을 위한 단일 정보 소스인 [Security → Data Scoping](/docs/security#data-scoping)를 참조하세요.

## 관련 문서 {#related}

- [Authentication](/docs/authentication#organizations) — 세션, 소셜 제공자 및 조직 관리 표면
- [Security → Data Scoping](/docs/security#data-scoping) — SQL 수준 격리, `ownableColumns()` 계약 및 액세스 가드
- [Multi-App Workspace](/docs/multi-app-workspace) — 공유 인증 및 RBAC를 사용하여 하나의 단일 저장소에서 여러 에이전트 기반 앱 호스팅
