---
title: "어댑터"
description: "프레임워크의 두 어댑터 이음새: 샌드박스 어댑터는 에이전트의 실행 코드 도구를 실행하는 백엔드를 교환하고 CLI 어댑터는 에이전트에 명령줄 도구에 대한 구조화된 액세스를 제공합니다."
search: "어댑터 샌드박스 어댑터 cli 어댑터 실행 코드 SandboxAdapter CliAdapter ShellCliAdapter 내구성 러너 원격 샌드박스 에지 서버리스 child_process"
---

# 어댑터

> **누구를 위한 것입니까:** 런타임을 확장하는 호스트 작성자. 앱 개발자는 거의 없습니다
> 이것이 필요합니다. 기본값은 기본적으로 작동합니다.

Agent-Native에는 좁은 뒤에 있는 문제를 고려하는 두 개의 어댑터 이음새가 있습니다.
교체 가능한 인터페이스:

- **샌드박스 어댑터**는 에이전트의 `run-code` 도구를 실행하는 백엔드를 교체합니다 —
  기본적으로 로컬 하위 프로세스 또는 Docker/원격/내구성 있는 실행기
- **CLI 어댑터**는 에이전트에게 명령줄 도구에 대한 구조화된 액세스를 제공합니다.
  (`gh`, `ffmpeg`, `stripe`) 검색, 가용성 확인 및
  일관된 결과 형태.

둘 다 하나의 런타임 제약 조건을 공유합니다. 즉, Node.js 시스템 바인딩에 의존하며
에지/작업자 런타임에서는 실행되지 않습니다. — [Edge and serverless](#edge-serverless)를 참조하세요.

## 어떤 코딩 문서를 원하나요? {#which-doc}

| 당신이 원하는 것은...                                                    | 사용                                         |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| 에이전트의 **`run-code` 도구**를 실행하는 백엔드 교체                    | **샌드박스 어댑터**(이 페이지)               |
| 상담원이 통화할 수 있도록 CLI 도구(`gh`, `ffmpeg`)를 래핑합니다.         | **CLI 어댑터** (이 페이지)                   |
| Claude-Code/Codex 스타일 **코딩 작업 공간 UI** 렌더링                    | [Agent-Native Code UI](/docs/code-agents-ui) |
| 자체 루프 + 도구를 사용하여 Claude 코드 / Codex / Pi **에이전트**로 실행 | [Harness Agents](/docs/harness-agents)       |

# 샌드박스 어댑터

`run-code` 도구는 격리된 환경에서 에이전트 제공 JavaScript를 실행합니다. **샌드박스 어댑터**는 에이전트 루프, `run-code.ts`, 로컬 호스트 브리지, 환경 스크럽 또는 출력 형식을 건드리지 않고도 백엔드(기본적으로 로컬 하위 프로세스 또는 Docker/원격/내구성 러너)를 교체할 수 있도록 해당 도구에서 _실행_ 문제를 고려하지 않습니다.

## 이음새가 있는 이유 {#why}

기본 백엔드는 잠긴 로컬 노드 하위 프로세스를 생성합니다. 이는 호스팅 프로세스에 의해 제한됩니다. 호스팅된 플랫폼에서는 에이전트 루프의 소프트 실행 한도(시간 초과/연속 스래시 전 ~40초)를 공유합니다. 원격 또는 내구성이 뛰어난 어댑터는 해당 한도를 초과할 수 있는 수단입니다. 요청 수명 주기와 관계없이 완료될 때까지 대규모 데이터 작업을 실행합니다.

계약을 좁게 유지한다는 것은 원격 어댑터가 동일한 보안 상태를 상속한다는 것을 의미합니다. 상위 프로세스는 비밀이 포함된 모든 것에 대한 소유권을 유지합니다. 즉, 샌드박스 모듈을 빌드하고, localhost 브리지(요청 컨텍스트를 보유하고 호스트 허용 목록 + SSRF 가드를 적용함)를 실행하고, 환경을 스크러빙하고 출력 형식을 지정합니다. 어댑터는 이미 준비된 **비밀이 아닌** 모듈 소스와 리소스 제한만 수신합니다. 어댑터는 이를 *실행*하고 stdout/stderr/exit 상태를 캡처하는 역할만 담당합니다.

```an-diagram title="부모는 비밀을 유지합니다. 어댑터는 코드만 실행합니다." summary="실행 코드는 모듈을 빌드하고 루프백 브리지를 실행합니다. 어댑터는 비밀이 아닌 모듈 + 제한을 수신하고 stdout/stderr/exit을 반환합니다."
{
  "html": "<div class=\"diagram-sandbox\"><div class=\"diagram-box\" data-rough><strong>부모 프로세스</strong><small class=\"diagram-muted\">모듈 빌드 · loopback 브리지 · env 정리 · 출력 형식</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">non-secret module + limits &rarr;</div><div class=\"diagram-pill ok\">&larr; stdout / stderr / exitCode</div><div class=\"diagram-pill\">&harr; bridge calls (127.0.0.1)</div></div><div class=\"diagram-panel center\" data-rough><strong>SandboxAdapter.run</strong><small class=\"diagram-muted\">로컬 자식 · Docker · 원격 · 지속</small></div></div>",
  "css": ".diagram-sandbox{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sandbox .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-sandbox .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 인터페이스 {#interface}

심은 `packages/core/src/coding-tools/sandbox/` — `adapter.ts`(계약), `index.ts`(선택: `getSandboxAdapter()` / `registerSandboxAdapter()`) 및 `local-child-process-adapter.ts`(기본값)의 코어에 있습니다. `run-code.ts`에 의해 패키지 내로 배선됩니다. 호스트는 `index.ts` 등록 도우미를 통해(또는 Docker 백엔드의 경우 이러한 파일을 직접 편집하는 [blueprint](/docs/blueprint-installer)를 통해) 다른 백엔드에 연결됩니다.

```an-file-tree title="core의 sandbox 접점"
{
  "title": "packages/core/src/coding-tools/sandbox/",
  "entries": [
    { "path": "adapter.ts", "note": "SandboxAdapter 계약(SandboxRunRequest / SandboxRunResult)" },
    { "path": "index.ts", "note": "선택: getSandboxAdapter() / registerSandboxAdapter()" },
    { "path": "local-child-process-adapter.ts", "note": "기본 backend: 잠긴 Node child process" },
    { "path": "../run-code.ts", "note": "이 접점을 연결; backend를 바꿔도 변경되지 않음" }
  ]
}
```

모든 백엔드는 `SandboxAdapter`를 구현합니다.

```ts
interface SandboxAdapter {
  /** Stable id, surfaced for diagnostics and adapter selection. */
  readonly id: string;
  /** Execute one prepared sandbox module and capture its output. */
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
```

요청과 결과는 의도적으로 작고 불투명합니다.

```ts
interface SandboxRunRequest {
  /**
   * The complete ESM module source to execute. Already wraps the user's code
   * and embeds the loopback bridge URL/token; the adapter does NOT parse or
   * rewrite it.
   */
  moduleSource: string;
  /**
   * Scrubbed environment — only safe POSIX vars (PATH/HOME/TMPDIR/…), never app
   * secrets. Adapters must not augment this with the parent's own environment.
   */
  env: Record<string, string>;
  /** Hard wall-clock timeout in milliseconds. The adapter must enforce it. */
  timeoutMs: number;
  /**
   * Loopback port of the parent's bridge server (reachable over 127.0.0.1). A
   * remote adapter that can't reach the parent's loopback must tunnel or proxy
   * this to support bridge-backed globals (`appAction`, `providerFetch`, …).
   */
  bridgePort: number;
}

interface SandboxRunResult {
  stdout: string;
  stderr: string;
  /** `0` on clean exit, non-zero on failure, `null` when killed by a signal. */
  exitCode: number | null;
  /** True when the run was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
}
```

## 기본값: `LocalChildProcessAdapter` {#default}

기본적으로 `getSandboxAdapter()`는 `LocalChildProcessAdapter`(`id: "local-child-process"`)를 반환합니다. 이는 과거 `run-code` 동작을 바이트 단위로 보존합니다.

- 준비된 모듈 소스는 새로운 임시 디렉토리에 기록됩니다.
- 하위 항목은 `TMPDIR`/`TEMP`/`TMP`가 샌드박스 디렉터리 내부를 가리키는 스크러빙된 환경(비밀 없음)으로 실행됩니다.
- 노드 권한 모델을 사용할 수 있는 경우(노드 20의 `--permission` 또는 `--experimental-permission`) 하위 항목은 임시 디렉토리 외부의 파일 시스템 액세스와 하위 프로세스, 작업자 및 기본 애드온이 거부됩니다. 아웃바운드 네트워크는 권한 모델에 의해 차단되지 _않지만_ 하지만 환경 스크럽은 그러한 요청에 자격 증명이 없으며 모든 인증된 호출이 상위 루프백 브리지를 통과함을 의미합니다.
- 시간 초과로 인해 `SIGTERM`가 전송되고 2초의 유예 기간 후에 `SIGKILL`가 전송됩니다.
- 임시 파일은 실행 후 최선을 다해 정리됩니다.

> [!WARNING]
> 기본 어댑터는 에지/작업자 런타임에 존재하지 않는 `node:child_process`를 사용합니다. 표준 Node.js 환경에서 `run-code`를 실행하거나 원격 어댑터를 등록하세요. [Edge and serverless](#edge-serverless)를 참조하세요.

## 어댑터 선택 {#selection}

해결 순서 - 명시적으로 등록된 어댑터가 우선합니다. 그렇지 않으면 env var가 내장된 항목을 선택합니다. 그렇지 않으면 로컬 기본값이 사용됩니다:

```text
registerSandboxAdapter(adapter)  →  AGENT_NATIVE_SANDBOX  →  local default
```

### `AGENT_NATIVE_SANDBOX` 환경 변수 {#env}

ID별로 내장 어댑터를 선택합니다. 현재는 `local`(기본값)만 연결되어 있습니다. 알 수 없는 값은 실행에 실패하지 않고 로컬로 대체됩니다.

```bash
AGENT_NATIVE_SANDBOX=local   # 기본값 - 명시적
```

### `registerSandboxAdapter()` {#register}

호스트 프로세스는 솔기의 `index.ts`를 통한 모든 후속 `run-code` 호출에 대해 백엔드를 재정의합니다. 예를 들어 원격 컨테이너에서 모든 호출을 실행합니다.

```ts
import {
  registerSandboxAdapter,
  type SandboxAdapter,
} from "./coding-tools/sandbox/index.js";

class RemoteSandboxAdapter implements SandboxAdapter {
  readonly id = "remote";
  async run(request) {
    // Ship request.moduleSource to the durable runner, enforce request.timeoutMs,
    // proxy bridge calls back to request.bridgePort, and return stdout/stderr/exitCode.
  }
}

registerSandboxAdapter(new RemoteSandboxAdapter());
// Pass `null` to clear the override and fall back to env-var / default resolution.
```

## 튼튼한 러너를 위한 솔기 {#durable}

이 인터페이스는 의도적으로 미래의 원격/내구성 샌드박스를 위한 이음새입니다. 원격 또는 내구성 있는 어댑터(Docker, Vercel-Sandbox 스타일 실행기 또는 대기 중인 백그라운드 작업자)는 다음을 수행합니다.

1. out-of-process 런타임에 대해 `SandboxAdapter.run`를 구현합니다.
2. 루프백 브리지(또는 프록시 브리지가 상위 브리지로 다시 호출)를 터널링합니다.
3. 요청 수명 주기와 관계없이 대규모 데이터 작업을 완료할 수 있습니다. 이는 로컬 하위 프로세스 어댑터를 제한하는 호스팅된 최대 40초 코드 실행 한도를 초과합니다.

새로운 `AGENT_NATIVE_SANDBOX` 값(예: `remote`) 및/또는 `registerSandboxAdapter()`를 통해 등록하세요. 에이전트 루프와 `run-code.ts`는 절대 변경되지 않습니다.

> [!TIP]
> `agent-native add sandbox docker` 청사진은 이 솔기에 대해 Docker 어댑터를 구현하기 위한 완전하고 독립적인 레시피를 내보냅니다. [Blueprint Installer](/docs/blueprint-installer)를 참조하세요.

# CLI 어댑터

다른 어댑터 이음매는 단일 명령줄 도구(`gh`, `ffmpeg`, `stripe`, `aws`)를 래핑하므로 에이전트는 이를 검색하고 설치 여부를 확인한 후 일관된 stdout/stderr/exit-code 결과로 실행할 수 있습니다. 모든 CLI 어댑터는 `CliAdapter`를 구현합니다:

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string; // "gh", "stripe", "ffmpeg"
  description: string; // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

대부분의 CLI의 경우 `ShellCliAdapter`는 합리적인 기본값으로 바이너리를 래핑하고 `CliRegistry`는 런타임 검색을 위해 어댑터를 수집합니다.

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({
    command: "gh",
    description: "GitHub CLI — manage repos, PRs, issues, and releases",
  }),
);

await cliRegistry.describe(); // [{ name, description, available }] for discovery
const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

CLI 호출을 `defineAction`로 래핑하여 작업 표면에 노출합니다. `ShellCliAdapter` 옵션, 사용자 정의 어댑터 및 작업 래핑 패턴에 대한 [CLI Adapters](/docs/cli-adapters) 빠른 참조를 확인하세요.

## 에지 및 서버리스 {#edge-serverless}

> [!WARNING]
> 두 어댑터 이음매 모두 Node.js 시스템 바인딩을 사용합니다. 샌드박스 `LocalChildProcessAdapter` 및 CLI 어댑터(`ShellCliAdapter` 및 사용자 지정 어댑터)는 Cloudflare Workers 또는 Netlify Edge Functions와 같은 에지/작업자 런타임에 **존재하지 않는** `node:child_process`(`execFile` / `spawn`)를 사용합니다. 이러한 에지 사전 설정에 서버 경로를 배포하는 경우 이러한 어댑터를 실행하면 런타임 예외가 발생합니다. 표준 Node.js 환경(기존 서버 컨테이너 또는 서버리스 노드 기능)에서 어댑터 엔드포인트 및 작업을 실행하거나 샌드박스 솔기의 경우 프로세스에서 벗어난 작업을 제공하는 원격 어댑터를 등록하세요.

## 다음 단계

- [**CLI Adapters**](/docs/cli-adapters) — CLI 솔기에 대한 빠른 참조
- [**Blueprint Installer**](/docs/blueprint-installer) — `agent-native add sandbox docker`는 Docker 어댑터 레시피를 인쇄합니다.
- [**Agent Teams**](/docs/agent-teams) — 하위 에이전트에 무거운 작업 위임
- [**Security**](/docs/security) — 환경 스크럽 및 브리지 허용 목록 상태
