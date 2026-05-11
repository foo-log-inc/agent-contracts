# artifact-contracts 分離提案

**Document Version**: 0.2.0
**DSL Spec Version**: artifactContracts 0.1.0
**Date**: 2026-05-11
**Status**: Proposal (Reviewed)

> 本提案書の文書版は 0.2.0。DSL spec は初期リリース候補として 0.1.0。

---

## 1. 背景

### 1.1 現状の課題

agent-contracts DSL の `artifacts` セクションには、2 つの異なる関心事が混在している。

**物理的定義**（artifact そのものの性質）:

- type, description, states, visibility
- `x-path-patterns`（ファイルパターン）
- `x-authority`（canonical / derived / generated）
- `x-no-manual-edit`（手動編集禁止）
- `x-drift-check`（drift 検出コマンド）
- `x-produced-by`（生成元ツール・コマンド）

**エージェント連携**（チームコンテキストでの権限マッピング）:

- owner, producers, editors, consumers（全てエージェント ID）
- required_validations
- guardrails

物理的定義はエージェントチームが存在しなくても成立する。一方エージェント連携は agent-contracts のコアである。

### 1.2 実プロジェクトでの問題

実プロジェクトでは `micro-contracts.guardrails.yaml` がプロジェクト全体のファイルガバナンス台帳として機能しているが、以下の問題がある:

- `allowed` / `protected` / `generated` 定義が micro-contracts guardrails と agent-contracts `policy.json` に分散し、整合性が保証されない
- `package-lock.json` のようなツールスコープ外のファイルのオーナーシップが不明確
- 生成ファイルの定義が micro-contracts YAML と agent-contracts policy.json で二重管理
- 各ツール（micro-contracts, speckeeper, embedoc, migraguard, litedbmodel-gen）が個別に drift チェックを行うが、プロジェクト全体の drift を横断的に管理する仕組みがない

### 1.3 LLM 対応 CLI における artifact 管理の必要性

各ツールに LLM コマンド（audit / propose / explain）を追加する計画において、ツール内部に agent-contracts DSL（エージェント定義）を持つことになる。この内部 DSL に artifact 定義を含めると、`team_interface.exposes.artifacts` / `imports` で DSL 間のアーティファクト入出力が可能になる。

しかし、artifact のライフサイクル管理（drift、manifest、coverage）は agent team 管理とは独立した関心事であり、独立した DSL・ツールチェインとして切り出すことで、各 contracts パッケージの責務が明確になる。

---

## 2. 提案: artifact-contracts の新設

### 2.1 `*-contracts` ファミリーの責務分離

| パッケージ | 責務 | 核心的な問い |
|---|---|---|
| **cli-contracts** | CLI インターフェース契約 | 「このツールをどう呼び出すか？」 |
| **artifact-contracts** (新規) | アーティファクトライフサイクル契約 | 「このプロジェクトのファイルがどう管理されるか？」 |
| **agent-contracts** | エージェントチーム契約 | 「このチームで誰が何をするか？」 |

参照関係:

```text
artifact-contracts
  └─ artifact ID / path / authority / drift

agent-contracts
  └─ artifact ID を参照して、agent role と workflow に割り当てる

cli-contracts
  └─ artifact ID を finding.target や evidence に使う
```

```text
                    ┌─────────────────────┐
                    │  artifact-contracts  │
                    │  物理的定義・drift   │
                    │  manifest・coverage  │
                    └──────┬──────────────┘
                           │ artifact ID を参照
              ┌────────────┼────────────┐
              ▼            │            ▼
   ┌──────────────┐        │     ┌──────────────┐
   │ cli-contracts │        │     │agent-contracts│
   │ CLI メタデータ│        │     │ チーム・権限  │
   └──────────────┘        │     └──────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐   ┌────────────┐   ┌────────────┐
   │micro-contr│   │ speckeeper │   │ migraguard │
   │  acts     │   │            │   │            │
   └───────────┘   └────────────┘   └────────────┘
```

### 2.2 artifact-contracts のアーキテクチャ

artifact-contracts は agent-contracts や agent-contracts-runtime に依存しない**独立したツールチェイン**として構成する。

```text
artifact-contracts (standalone package)
  ├─ core
  │   ├─ schema (Zod)
  │   ├─ resolver
  │   ├─ glob matcher
  │   ├─ artifact lookup (path → artifact ID)
  │   ├─ manifest model
  │   └─ drift runner
  ├─ CLI
  │   ├─ validate / list / explain
  │   ├─ drift / manifest
  │   ├─ coverage
  │   ├─ import / export
  │   └─ plan
  └─ export adapters
      ├─ policy-json
      ├─ agent-contracts
      └─ guardrails

agent-contracts
  └─ artifact-contracts core を読み込み、agent 側 artifact mapping と merge

agent-contracts-runtime
  └─ agent 実行時コンテキストに artifact 情報を渡す（薄い統合レイヤー）
```

artifact の DSL parse / validate / resolve / drift 実行は全て artifact-contracts 側が持つ。agent-contracts-runtime には、エージェント実行時コンテキストへの artifact 情報の受け渡しのみを置く。

### 2.3 artifact-contracts が担うもの

1. **アーティファクト定義 DSL** — スコープ（file / region）、authority、provenance、状態
2. **drift チェック** — 全アーティファクトの横断的な整合性検証（実行安全ポリシー付き）
3. **マニフェスト管理** — source と output の対応関係を含む、ハッシュベースの完全性検証
4. **カバレッジ検査** — プロジェクトのファイルツリーに対するアーティファクト定義のカバー率
5. **エクスポート** — agent-contracts、policy.json 向けの出力
6. **ツール artifact の集約** — 各 CLI ツールから出力されたアーティファクト情報のマージ（conflict policy 付き）

### 2.4 artifact-contracts が担わないもの

- エージェント権限の管理（can_read / can_write） → agent-contracts
- タスクやワークフローの定義 → agent-contracts
- CLI コマンドのインターフェース定義 → cli-contracts
- 個別ツールの lint / check 実行 → 各ツール自身

---

## 3. DSL 設計

### 3.1 ファイル構成

```text
artifact-contracts.yaml          # メインの artifact 定義（「何か」）
artifact-contracts.config.yaml   # 処理設定（「どう処理するか」）
```

**contract** は artifact の性質と関係を宣言する。**config** は処理方法、プロファイル、インポート設定を定義する。

```yaml
# artifact-contracts.config.yaml
input:
  files:
    - artifact-contracts.yaml

variables:
  embedoc_target_patterns:
    - "docs/**/*.md"
    - "packages/*/README.md"

manifest:
  path: .artifact-contracts/manifest.json

imports:
  - command: "npx micro-contracts artifacts"
    format: json

profiles:
  local:
    shell: true
  ci:
    shell: false
    allow_commands:
      - "npx micro-contracts check --only drift,manifest"
```

DSL 内で `${vars.variable_name}` 構文を使用すると、config の `variables` で定義した値に展開される。これは agent-contracts の変数展開構文と統一されている。プロジェクト固有のパスを contract 定義から分離できる。

#### 変数展開仕様

展開処理の順序:

1. config 読み込み
2. `variables` の値で `${vars.*}` を展開
3. 配列変数がある場合は親配列に flatten
4. DSL schema validation

配列変数の展開ルール:

```yaml
# config
variables:
  embedoc_target_patterns:
    - "docs/**/*.md"
    - "packages/*/README.md"
```

```yaml
# DSL（展開前）
path_patterns:
  - "${vars.embedoc_target_patterns}"
```

```yaml
# 展開後（配列は親配列に flatten）
path_patterns:
  - "docs/**/*.md"
  - "packages/*/README.md"
```

string 変数はそのまま展開される。配列変数は、`path_patterns` のような配列フィールド内で使用された場合に親配列へ flatten される。配列変数を string フィールド内で使用した場合は validation error とする。

### 3.2 スキーマ

```yaml
# artifact-contracts.yaml
artifactContracts: 0.1.0

system:
  id: my-project
  name: My Project Artifact Registry

artifacts:
  # ── ツール生成物 ──
  api-contracts:
    type: generated-code
    description: "Generated contract packages from OpenAPI specs"
    authority: generated
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - "contracts/**"
        - "**/*.generated.ts"
        - "**/*.generated.yaml"

    sources:
      - id: openapi-specs
        role: ssot
        scope:
          kind: file
          path_patterns:
            - "api/**/openapi/*.yaml"
      - id: overlays
        role: config
        scope:
          kind: file
          path_patterns:
            - "api/_shared/overlays/**"

    produced_by:
      tool: micro-contracts
      command: generate
      args:
        - "--config"
        - "micro-contracts.config.yaml"

    repair:
      command: "npx micro-contracts generate --config micro-contracts.config.yaml"
      execution:
        risk_level: low
        side_effects: [file_write]
        idempotent: true
        requires_confirmation: false

    drift_check:
      strategy: manifest

    states: [stale, current]

  design-specs:
    type: generated-doc
    description: "Generated spec documents from TypeScript definitions"
    authority: derived
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - "specs/**"

    sources:
      - id: spec-definitions
        role: ssot
        scope:
          kind: file
          path_patterns:
            - "design/**/*.ts"

    produced_by:
      tool: speckeeper
      command: build

    repair:
      command: "npx speckeeper build"
      execution:
        risk_level: low
        side_effects: [file_write]
        idempotent: true

    drift_check:
      strategy: command-exit-code
      command: "npx speckeeper drift"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

    states: [stale, current]

  doc-markers:
    type: generated-content
    description: "embedoc marker regions within documents"
    authority: generated
    manual_edit: forbidden

    scope:
      kind: region
      path_patterns:
        - "${vars.embedoc_target_patterns}"
      markers:
        start: "<!-- embedoc:start -->"
        end: "<!-- embedoc:end -->"

    produced_by:
      tool: embedoc
      command: build

    drift_check:
      strategy: command-exit-code
      command: "npx embedoc build --dry-run && git diff --exit-code"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

  model-columns:
    type: generated-content
    description: "litedbmodel column definitions within model files"
    authority: generated
    manual_edit: forbidden

    scope:
      kind: region
      path_patterns:
        - "db/models/**/*.ts"
      markers:
        start: "/* embedoc:start:model-columns */"
        end: "/* embedoc:end:model-columns */"

    sources:
      - id: ddl-schema
        role: ssot
        scope:
          kind: file
          path_patterns:
            - "db/schema.sql"

    produced_by:
      tool: litedbmodel-gen
      command: "(via embedoc build)"

    drift_check:
      strategy: command-exit-code
      command: "npx embedoc build --dry-run && git diff --exit-code"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

  migration-files:
    type: source
    description: "SQL migration files"
    authority: canonical
    manual_edit: allowed
    change_control: approval-required

    scope:
      kind: file
      path_patterns:
        - "db/migrations/**/*.sql"

  # ── ツールスコープ外 ──
  dependency-lock:
    type: lockfile
    description: "npm lockfile"
    authority: generated
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - "package-lock.json"

    produced_by:
      tool: npm
      command: install

    drift_check:
      strategy: command-exit-code
      command: "npm ci --dry-run"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

  cursor-rules:
    type: generated-config
    description: "Generated Cursor IDE rules"
    authority: generated
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - ".cursor/rules/*.mdc"

    produced_by:
      tool: agent-contracts
      command: generate

    repair:
      command: "npx agent-contracts generate"
      execution:
        risk_level: low
        side_effects: [file_write]
        idempotent: true

    drift_check:
      strategy: command-exit-code
      command: "npx agent-contracts generate --check"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

  cursor-policy:
    type: generated-config
    description: "Generated Cursor guardrail policy"
    authority: generated
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - ".cursor/guardrails/policy.json"

    produced_by:
      tool: agent-contracts
      command: "generate guardrails"

    drift_check:
      strategy: command-exit-code
      command: "npx agent-contracts generate guardrails --check"
      execution:
        risk_level: low
        side_effects: []
        idempotent: true

  # ── ソースコード（canonical） ──
  application-code:
    type: source
    description: "Application source code"
    authority: canonical
    manual_edit: allowed

    scope:
      kind: file
      path_patterns:
        - "server/**/*.ts"
        - "frontend/**/*.tsx"
        - "frontend/**/*.ts"

  api-specs:
    type: source
    description: "OpenAPI specification files (SSoT)"
    authority: canonical
    manual_edit: allowed
    change_control: approval-required

    scope:
      kind: file
      path_patterns:
        - "api/**/openapi/*.yaml"

  api-overlays:
    type: config
    description: "Horizontal overlay definitions"
    authority: canonical
    manual_edit: allowed
    change_control: approval-required

    scope:
      kind: file
      path_patterns:
        - "api/_shared/overlays/**"

  # ── スキーマ生成物 ──
  agent-handoff-schemas:
    type: schema
    description: "Generated JSON Schemas exported from agent-contracts handoff_types"
    authority: generated
    manual_edit: forbidden
    change_control: regeneration-required

    scope:
      kind: file
      path_patterns:
        - "schemas/agent-contracts/**/*.schema.json"

    sources:
      - id: agent-handoff-types
        role: ssot
        scope:
          kind: file
          path_patterns:
            - "agent-contracts.yaml"
            - "handoff-types/**/*.yaml"

    produced_by:
      tool: agent-contracts
      command: "generate schemas"

    repair:
      command: "npx agent-contracts generate schemas"
      execution:
        risk_level: low
        side_effects: [file_write]
        idempotent: true

    drift_check:
      strategy: manifest

# ── ポリシー ──
policies:
  import:
    on_conflict: error
    id_namespace: project

  manifest:
    path: ".artifact-contracts/manifest.json"
    hash_algorithm: sha256
    include:
      - artifact_id
      - path
      - content_hash
      - source_hash
      - produced_by
      - generated_at
```

### 3.3 Artifact プロパティ

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | string | Yes | artifact の種別（`source`, `generated-code`, `generated-doc`, `generated-content`, `generated-config`, `config`, `lockfile`） |
| `description` | string | No | 説明 |
| `authority` | enum | Yes | `canonical`（人間が書く SSoT）, `derived`（SSoT から派生）, `generated`（ツールが完全生成）, `control`（制御・設定ファイル） |
| `manual_edit` | enum | No | `allowed`（編集可）, `discouraged`（非推奨）, `forbidden`（禁止）。デフォルトは authority に基づく |
| `change_control` | enum | No | `none`, `approval-required`, `regeneration-required` |
| `scope` | object | Yes | artifact のスコープ定義（3.4 節参照） |
| `sources` | object[] | No | 生成元ソース定義のリスト（3.5 節参照） |
| `produced_by` | object | No | 生成元ツール（tool, command, args） |
| `repair` | object | No | drift 修復コマンド（3.9 節参照） |
| `drift_check` | object | No | drift 検出方法（command, strategy, execution）（3.6 節参照） |
| `states` | string[] | No | 取りうる状態 |

#### authority と manual_edit / change_control のデフォルト関係

`authority` は「何が正か」を表し、`manual_edit` は「人間が編集してよいか」を表し、`change_control` は「変更時にどういうプロセスが必要か」を表す。明示的に指定した場合はデフォルトを上書きする。

| authority | manual_edit (default) | change_control (default) | 典型的な用途 |
|---|---|---|---|
| `canonical` | `allowed` | `none` | 人間が書く SSoT |
| `canonical` + approval | `allowed` | `approval-required` | 変更に承認が必要な SSoT |
| `derived` | `forbidden` | `regeneration-required` | SSoT から派生した生成物 |
| `generated` | `forbidden` | `regeneration-required` | ツールが完全生成するファイル |
| `control` | `allowed` | `approval-required` | 制御・設定ファイル |

### 3.4 scope

`scope` は artifact が対象とするファイル/領域の範囲を定義する。

初期版では以下の 2 種類を提供する。ディレクトリ配下を対象にしたい場合も `file` + glob（`"contracts/**"`）で表現できるため、`directory` scope は初期版では不要。

| scope.kind | 説明 | 追加プロパティ |
|---|---|---|
| `file` | ファイル単位 | `path_patterns` |
| `region` | ファイル内の一部領域 | `path_patterns`, `markers` |

```yaml
# file scope
scope:
  kind: file
  path_patterns:
    - "contracts/**"

# region scope（ファイル内の一部領域）
scope:
  kind: region
  path_patterns:
    - "db/models/**/*.ts"
  markers:
    start: "/* embedoc:start:model-columns */"
    end: "/* embedoc:end:model-columns */"

# config 変数を使った region scope
scope:
  kind: region
  path_patterns:
    - "${vars.embedoc_target_patterns}"
  markers:
    start: "<!-- embedoc:start -->"
    end: "<!-- embedoc:end -->"
```

`path_patterns` 内の `${vars.variable_name}` は `artifact-contracts.config.yaml` の `variables` で解決される（3.1 節参照）。プロジェクトごとに異なるパスは DSL 側を変更せず config で切り替え可能。変数展開後のパターンは全て静的な glob になるため、coverage 計算やバリデーションは変数解決後に確定的に実行できる。

#### region scope のオーナーシップモデル

region artifact のオーナーは単一のツールチェインである。1 つのファイル内に複数の region artifact が存在する場合でも、各 region のオーナーは 1 つ。

```text
db/models/user.ts
  ├─ ファイル全体: application-code (authority: canonical, owner: 開発者)
  └─ マーカー領域: model-columns (authority: generated, owner: litedbmodel-gen)
```

- region の生成・更新は `produced_by` のツールチェインが行う
- 外部プログラム（embedoc 等）がマーカー領域を編集することは許容される
- drift チェックや整合性検証は、region を所有するツールチェインの責務
- ファイルレベルの artifact と region レベルの artifact は独立して管理され、coverage はファイル全体にマッチした artifact と region にマッチした artifact の両方がカウントされる

### 3.5 sources

`sources` は artifact の生成元を定義する。単一の SSoT だけでなく、複数ソース（SSoT + overlay + config 等）を表現できる。

```yaml
sources:
  - id: openapi-specs
    role: ssot
    scope:
      kind: file
      path_patterns:
        - "api/**/openapi/*.yaml"

  - id: overlays
    role: config
    scope:
      kind: file
      path_patterns:
        - "api/_shared/overlays/**"
```

| source プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | Yes | ソース識別子 |
| `role` | enum | Yes | `ssot`（正の情報源）, `config`（設定）, `template`（テンプレート） |
| `scope` | object | Yes | ソースのスコープ（artifact の scope と同じ構造） |

### 3.6 drift_check

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `strategy` | enum | Yes | `manifest`, `command-exit-code` |
| `command` | string | No | 実行コマンド（strategy が `command-exit-code` の場合は必須） |
| `command_ref` | object | No | cli-contracts のコマンド参照（command の代替） |
| `execution` | object | No | 実行安全ポリシー（strategy が `command-exit-code` の場合に推奨） |

#### drift_check.strategy

初期版では 2 つの strategy を提供する。

| strategy | 説明 | 検証主体 | 適用例 |
|---|---|---|---|
| `manifest` | artifact-contracts 内蔵の manifest 検証 | artifact-contracts 自身 | source/output hash 比較 |
| `command-exit-code` | 外部コマンドの exit code で判定 | 外部ツール | speckeeper drift, npm ci, 生成+git diff |

`manifest` strategy は `artifact-contracts manifest --verify` 相当の内蔵検証を実行する。外部ツールが必要な場合は `command-exit-code` を使用する。

`git diff` ベースの検証（生成してから diff を見る）は `command-exit-code` で表現する:

```yaml
drift_check:
  strategy: command-exit-code
  command: "npx agent-contracts generate --check"
```

#### drift_check.execution

LLM エージェントや CI が drift check を実行する際の安全性判断に使用する。`manifest` strategy は artifact-contracts 内蔵のため execution は不要。`command-exit-code` の場合に記述する。

```yaml
execution:
  risk_level: low | medium | high
  side_effects: []
  idempotent: true
  requires_confirmation: false
```

#### drift_check.command_ref

`command` の代わりに cli-contracts のコマンドを参照することも可能。command string は実装が早いが、diff・互換性検証・LLM 安全判断が弱くなるため、スキーマ上は `command` と `command_ref` の両方を持てるようにする。

```yaml
drift_check:
  command_ref:
    cli_contract: ./cli-contract.yaml
    command: micro-contracts.check
    mode: drift
  strategy: command-exit-code
  execution:
    risk_level: low
    side_effects: []
    idempotent: true
```

### 3.7 manifest

マニフェストは単なる checksum ではなく、**source と output の対応関係**を含む完全性検証モデル。source が変更されていれば output も再生成が必要、source が同じなのに output が変わっていれば不正な手動編集の可能性がある。

マニフェスト設定は `policies.manifest` で定義する:

```yaml
policies:
  manifest:
    path: ".artifact-contracts/manifest.json"
    hash_algorithm: sha256
    include:
      - artifact_id
      - path
      - content_hash
      - source_hash
      - produced_by
      - generated_at
```

マニフェストファイルはプロジェクト全体で 1 つ。各 artifact のエントリを含む:

```json
{
  "version": "0.1.0",
  "generatedAt": "2026-05-11T06:00:00Z",
  "entries": [
    {
      "artifactId": "api-contracts",
      "files": [
        {
          "path": "contracts/billing/index.ts",
          "contentHash": "sha256:abc123...",
          "sourceHashes": [
            {
              "sourceId": "openapi-specs",
              "path": "api/billing/openapi/billing.yaml",
              "hash": "sha256:def456..."
            }
          ],
          "producedBy": {
            "tool": "micro-contracts",
            "command": "generate"
          },
          "generatedAt": "2026-05-11T06:00:00Z"
        }
      ]
    }
  ]
}
```

region artifact の hash は抽出した領域のコンテンツに対して計算する。config 変数で展開された path_patterns は、展開後の glob に対してマッチしたファイル/領域の hash を計算する。

マニフェストファイル自体の authority は `generated` であり、`artifact-contracts manifest` コマンドが更新を行う。

### 3.8 import policy

ツール artifact の取り込み時に同一 artifact ID が競合した場合の挙動を定義する。

```yaml
policies:
  import:
    on_conflict: error | keep-local | prefer-imported | require-explicit-override
    id_namespace: tool | project | none
```

| on_conflict | 説明 |
|---|---|
| `error` | 競合時にエラーで停止（**推奨デフォルト**） |
| `keep-local` | ローカル定義を優先 |
| `prefer-imported` | インポート側を優先 |
| `require-explicit-override` | 明示的なオーバーライド宣言を必要とする |

初期値は **`error`** とする。自動マージで静かに上書きすると、artifact 台帳の信頼性が低下する。

### 3.9 artifact ID 命名規則

artifact ID は YAML のキーとして使用され、import / export / agent-contracts 参照で安定した識別子となる。

| ルール | 説明 |
|---|---|
| 文字種 | 英小文字、数字、ハイフン（`[a-z0-9-]+`） |
| 形式 | kebab-case |
| 予約 | `.` を含む ID は将来の namespace 拡張用に予約（初期版では使用不可） |

```yaml
# 良い例
api-contracts:
dependency-lock:
cursor-rules:
model-columns:

# 悪い例
API_Contracts:       # 大文字・アンダースコア不可
api.contracts:       # ドット予約
apiContracts:        # camelCase 不可
```

`policies.import.id_namespace` が `tool` の場合、将来的に `<tool>.<id>` 形式（例: `micro-contracts.api-contracts`）を許可する拡張を想定する。

### 3.10 repair

`repair` は drift が検出された artifact を修復するためのコマンドを定義する。`plan` コマンドが修復アクションプランを生成する際に使用する。

`produced_by` はメタデータ（何が生成したか）であり、`repair` は実行可能なコマンド（どう直すか）である。

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `command` | string | Yes | 修復コマンド |
| `command_ref` | object | No | cli-contracts のコマンド参照（command の代替） |
| `execution` | object | Yes | 実行安全ポリシー（drift_check.execution と同構造） |

```yaml
repair:
  command: "npx micro-contracts generate --config micro-contracts.config.yaml"
  execution:
    risk_level: low
    side_effects: [file_write]
    idempotent: true
    requires_confirmation: false
```

`repair` は optional。定義がない場合、`plan` コマンドは `produced_by` の情報を元に推奨アクションを提示するが、実行可能なコマンドは出力しない。

---

## 4. CLI 設計

artifact-contracts は独立した CLI を持つ。

### 4.1 コマンド一覧

```text
artifact-contracts validate          # DSL 定義の検証
artifact-contracts resolve           # 変数展開・デフォルト解決済み DSL を出力
artifact-contracts list              # 登録済み artifact の一覧
artifact-contracts list --authority generated
artifact-contracts list --path <file>
artifact-contracts explain <path>    # ファイルの artifact 情報を表示
artifact-contracts drift             # 全 artifact の drift チェック
artifact-contracts drift <id>        # 特定 artifact の drift チェック
artifact-contracts coverage          # ファイルカバレッジ検査
artifact-contracts manifest          # マニフェスト生成
artifact-contracts manifest --verify # マニフェスト検証
artifact-contracts import            # ツール artifact の取り込み
artifact-contracts export            # 外部形式へのエクスポート
artifact-contracts plan              # drift 解消のアクションプラン
```

### 4.2 `resolve` コマンド

config 変数の展開と authority に基づくデフォルト値の解決を行い、完全に展開された DSL を出力する。

```bash
# デフォルト展開済み DSL を出力
artifact-contracts resolve

# YAML 出力
artifact-contracts resolve --format yaml
```

`authority: generated` で `manual_edit` 未指定の artifact は、resolve 後に `manual_edit: forbidden`, `change_control: regeneration-required` が明示される。export adapter や LLM エージェントは resolve 済みの DSL を消費することで、デフォルト解決ロジックを自前で持つ必要がなくなる。

### 4.3 `list` コマンド

登録済み artifact の一覧表示と検索。

```bash
# 全 artifact 一覧
artifact-contracts list

# authority でフィルタ
artifact-contracts list --authority generated

# パスから artifact ID を逆引き
artifact-contracts list --path package-lock.json

# JSON 出力
artifact-contracts list --format json
```

LLM エージェントが対象ファイルの扱いを判断する際にも有用。

### 4.4 `explain` コマンド

指定パスの artifact 情報を人間向けに表示する。

```bash
artifact-contracts explain package-lock.json
```

出力例:

```text
package-lock.json
  artifact: dependency-lock
  authority: generated
  manual edit: forbidden
  change control: regeneration-required
  produced by: npm install
  drift check: npm ci --dry-run
```

```bash
artifact-contracts explain contracts/billing/index.ts
```

出力例:

```text
contracts/billing/index.ts
  artifact: api-contracts
  authority: generated
  manual edit: forbidden
  change control: regeneration-required
  produced by: micro-contracts generate
  sources:
    - openapi-specs: api/**/openapi/*.yaml (ssot)
    - overlays: api/_shared/overlays/** (config)
  drift check: manifest (built-in)
  repair: npx micro-contracts generate --config micro-contracts.config.yaml
```

台帳としてすぐ価値が出るため、drift より先に実装する。LLM エージェントとの相性も非常に良い。

### 4.5 `drift` コマンド

全 artifact（または指定 artifact）の `drift_check` を実行する。

```bash
# 全 artifact
artifact-contracts drift --config artifact-contracts.yaml

# 特定 artifact のみ
artifact-contracts drift api-contracts

# authority=generated のみ
artifact-contracts drift --authority generated

# CI 用: exit code で判定
artifact-contracts drift --fail-on-drift
```

処理フロー:

1. artifact 定義を読み込み
2. `drift_check` が定義されている artifact をフィルタ
3. `drift_check.execution` ポリシーに基づいて安全性を検証
4. 各 artifact の drift_check.command を実行
5. 結果を集約して報告（JSON / text / yaml）

### 4.6 `coverage` コマンド

`git ls-files` の全ファイルに対して、artifact の `scope` でカバーされている割合を検査する。

```bash
artifact-contracts coverage --config artifact-contracts.yaml

# 出力例:
# Coverage: 142/158 files (89.9%)
# Uncovered files:
#   .eslintrc.js
#   tsconfig.json
#   ...
```

カバレッジ率のしきい値を CI ゲートとして使用可能:

```bash
artifact-contracts coverage --threshold 90
```

未管理ファイルの検出から、source / control / generated / ignore のいずれかに分類する判断材料を提供する。

### 4.7 `plan` コマンド

drift が検出された artifact に対して、修復アクションプランを出力する。

```bash
# drift がある全 artifact のプラン
artifact-contracts plan --drift

# 特定 artifact のプラン
artifact-contracts plan api-contracts
```

出力例（`repair` が定義されている場合）:

```json
{
  "artifact": "api-contracts",
  "status": "drifted",
  "repair": {
    "command": "npx micro-contracts generate --config micro-contracts.config.yaml",
    "execution": {
      "riskLevel": "low",
      "sideEffects": ["file_write"],
      "idempotent": true,
      "requiresConfirmation": false
    }
  }
}
```

出力例（`repair` が未定義の場合）:

```json
{
  "artifact": "dependency-lock",
  "status": "drifted",
  "repair": null,
  "producedBy": {
    "tool": "npm",
    "command": "install"
  },
  "hint": "No repair command defined. Produced by: npm install"
}
```

LLM エージェントが drift 修復を実行する前の安全判断に使用できる。`repair` が定義されていれば `execution` ポリシーに基づいて自動実行の可否を判断できる。

### 4.8 `import` コマンド

各ツールが出力した artifact 情報を取り込み、artifact-contracts.yaml にマージする。

```bash
# ツールの artifacts コマンド出力（JSON）を取り込み
artifact-contracts import --from micro-contracts-artifacts.json
artifact-contracts import --from speckeeper-artifacts.json

# パイプ経由
npx micro-contracts artifacts | artifact-contracts import --from -
```

入力形式は後述の「ツール artifact 出力プロトコル」に従う。`policies.import.on_conflict` に基づいて競合を処理する。

### 4.9 `export` コマンド

他の contracts パッケージや policy.json 向けにエクスポートする。

```bash
# agent-contracts の artifacts セクション向け
artifact-contracts export --format agent-contracts --output artifacts-for-ac.yaml

# Cursor policy.json の protect-generated-files ルール向け
artifact-contracts export --format policy-json --output policy-fragment.json

# micro-contracts guardrails.yaml の generated/protected 向け
artifact-contracts export --format guardrails --tool micro-contracts
```

---

## 5. ツール artifact 出力プロトコル

### 5.1 概要

LLM 対応 CLI ツールが内部の agent-contracts DSL とツール設定から artifact 情報を抽出し、artifact-contracts 互換の形式で出力する標準コマンド。

cli-contracts のリファレンス仕様として `artifacts` コマンドを定義する。

### 5.2 コマンド仕様

```bash
# 標準的な呼び出し
micro-contracts artifacts
speckeeper artifacts
embedoc artifacts
migraguard artifacts
litedbmodel-gen artifacts

# オプション
--config <path>     # ツール設定ファイル
--output <path>     # 出力先（デフォルト: stdout）
--format <fmt>      # json | yaml（デフォルト: json）
```

### 5.3 出力形式

```json
{
  "tool": "micro-contracts",
  "version": "0.15.0",
  "generatedAt": "2026-05-11T06:00:00Z",
  "artifacts": [
    {
      "id": "api-contracts-generated",
      "type": "generated-code",
      "description": "Generated contract packages from OpenAPI specs",
      "authority": "generated",
      "manualEdit": "forbidden",
      "scope": {
        "kind": "file",
        "pathPatterns": ["contracts/**", "**/*.generated.ts"]
      },
      "sources": [
        {
          "id": "openapi-specs",
          "role": "ssot",
          "scope": {
            "kind": "file",
            "pathPatterns": ["api/**/openapi/*.yaml"]
          }
        }
      ],
      "producedBy": {
        "tool": "micro-contracts",
        "command": "generate"
      },
      "driftCheck": {
        "command": "npx micro-contracts check --only drift,manifest",
        "strategy": "manifest",
        "execution": {
          "riskLevel": "low",
          "sideEffects": [],
          "idempotent": true
        }
      }
    },
    {
      "id": "api-specs-source",
      "type": "source",
      "description": "OpenAPI specification files (SSoT)",
      "authority": "canonical",
      "manualEdit": "allowed",
      "changeControl": "approval-required",
      "scope": {
        "kind": "file",
        "pathPatterns": ["api/**/openapi/*.yaml"]
      }
    }
  ]
}
```

### 5.4 処理フロー

1. ツールの設定ファイル（`micro-contracts.config.yaml` 等）を読み込み
2. ツール内部の agent-contracts DSL（`dsl/artifacts.yaml`）を読み込み
3. 設定値でパスパターンを具体化（テンプレート変数の解決）
4. `team_interface.exposes.artifacts` でフィルタ（外部公開分のみ）
5. artifact-contracts 互換の JSON/YAML を出力

### 5.5 cli-contracts への追加

cli-contracts のリファレンス仕様に `artifacts` コマンドパターンを追加する。`artifacts` は LLM-backed command ではなく、**deterministic metadata export command** として位置づける:

```yaml
# cli-contracts リファレンス: LLM 連携 CLI の標準コマンド
# audit, propose, explain に並ぶ第4の標準パターン
artifacts:
  summary: Export tool artifact declarations for artifact-contracts integration.
  description: >-
    Reads the tool's internal agent-contracts DSL and tool configuration,
    resolves path patterns with actual config values, and outputs artifact
    metadata in artifact-contracts-compatible format.
  category: metadata
  deterministic: true
  usage:
    - "{tool} artifacts"
    - "{tool} artifacts --format yaml --output artifacts.yaml"
  options:
    config:
      type: string
      description: Tool configuration file path.
    output:
      type: string
      aliases: [o]
      description: Write output to file instead of stdout.
    format:
      type: string
      enum: [json, yaml]
      default: json
      description: Output format.
  exits:
    '0':
      description: Artifacts exported successfully.
      stdout:
        format: '{options.format}'
    '1':
      description: Unexpected error.
    '3':
      description: Configuration not found or invalid.
  x-agent:
    riskLevel: low
    idempotent: true
    sideEffects: [file_write]
    sideEffectNote: >-
      Filesystem write only when --output is specified.
      No network calls.
    safeDryRunOption: null
```

---

## 6. agent-contracts からの参照

### 6.1 artifact 定義の分離

agent-contracts の `artifacts` セクションから物理的定義を分離し、artifact-contracts を参照する形にする。

**変更前**（現在の agent-contracts）:

```yaml
artifacts:
  api-contracts:
    type: generated-code
    description: "Generated contract packages"
    owner: architect
    producers: [architect]
    editors: []
    consumers: [implementer, test-writer]
    states: [stale, current]
    x-authority: generated
    x-no-manual-edit: true
    x-path-patterns: ["contracts/**"]
    x-drift-check:
      command: "npx micro-contracts check --only drift"
```

**変更後**（artifact-contracts 分離後）:

```yaml
# artifact-contracts.yaml（物理的定義）
artifacts:
  api-contracts:
    type: generated-code
    description: "Generated contract packages"
    authority: generated
    manual_edit: forbidden
    scope:
      kind: file
      path_patterns: ["contracts/**"]
    drift_check:
      command: "npx micro-contracts check --only drift"
      strategy: manifest
    states: [stale, current]
```

```yaml
# agent-contracts DSL（エージェント連携のみ）
artifact_source: ./artifact-contracts.yaml

artifacts:
  api-contracts:
    # type, scope, authority 等は artifact-contracts から解決
    owner: architect
    producers: [architect]
    editors: []
    consumers: [implementer, test-writer]
    required_validations: [contract-review]
    guardrails: [protect-generated-files]
```

### 6.2 `artifact_source` フィールド

agent-contracts DSL のトップレベルに `artifact_source` を追加。artifact-contracts YAML へのパスを指定する。

```yaml
# agent-contracts.yaml
version: 1
system:
  id: my-project
  name: My Project

artifact_source: ./artifact-contracts.yaml   # 新規フィールド

agents: { $ref: "./agents/" }
tasks: { $ref: "./tasks.yaml" }
artifacts: { $ref: "./artifacts.yaml" }       # エージェント連携のみ
```

resolve 時の動作:

1. `artifact_source` が指定されている場合、artifact-contracts YAML を読み込み
2. `artifacts` セクションの各 artifact ID に対して、artifact-contracts 側の物理的定義をマージ
3. agent-contracts 側にのみ存在するプロパティ（owner, producers, editors, consumers, required_validations, guardrails）はそのまま保持
4. 物理的プロパティ（type, scope, authority, drift_check 等）は artifact-contracts 側が権威
5. artifact-contracts に存在しない artifact ID が agent-contracts にある場合は warning（物理的定義がない）
6. artifact-contracts に存在するが agent-contracts にない artifact ID は無視（エージェント連携が不要）

### 6.3 後方互換性

`artifact_source` は optional。指定しない場合、現在と同じ動作（`artifacts` セクションに全てをインラインで定義）。

`x-path-patterns`, `x-authority`, `x-no-manual-edit` 等の既存 extension も引き続き有効。`artifact_source` が指定されている場合、artifact-contracts 側の値が優先される。

### 6.4 `producers` の用語整理

artifact-contracts の `produced_by` と agent-contracts の `producers` は名前が似ているが、意味が異なる:

| フィールド | 所属 | 意味 |
|---|---|---|
| `produced_by` | artifact-contracts | 物理的な生成主体（ツールまたはコマンド） |
| `producers` | agent-contracts | ワークフロー上の生産担当エージェント |

ドキュメントおよびスキーマ定義で、この区別を明示する。

### 6.5 team_interface / imports との関係

`team_interface.exposes.artifacts` と `imports` の仕組みは引き続きエージェントチーム間連携に使用する。

artifact-contracts は**プロジェクト全体のファイルガバナンス**を担い、agent-contracts の `team_interface` は**エージェントチーム間のワークフロー連携**を担う。両者は補完的:

- artifact-contracts: 「このファイル群は micro-contracts が生成する」（物理的事実）
- agent-contracts team_interface: 「このチームは api-contracts を公開する」（チーム契約）

---

## 7. cli-contracts からの参照

### 7.1 AgentAuditResult での artifact 情報

cli-contracts の `AgentAuditResult` / `AgentFinding` スキーマで、finding の `target` や `evidence` に artifact ID を使用できる:

```yaml
# AgentFinding
target: "artifact:api-contracts"        # artifact-contracts の artifact ID
location: "contracts/billing/index.ts"  # artifact 内の具体パス
```

### 7.2 `artifacts` コマンドの標準化

5.5 節で述べた通り、cli-contracts のリファレンス仕様に `artifacts` コマンドパターンを追加する。LLM 対応 CLI の標準コマンドは以下の 4 パターンとなる:

| パターン | 目的 | 性質 | 出力 |
|---|---|---|---|
| `audit` | セマンティックレビュー | LLM-backed | AgentAuditResult |
| `propose` | 構造化提案の生成 | LLM-backed | AgentAuditResult + ドメイン固有フィールド |
| `explain` | 機械出力の人間向け説明 | LLM-backed | AgentAuditResult + explanation |
| `artifacts` | artifact 情報のエクスポート | deterministic | artifact-contracts 互換 JSON/YAML |

---

## 8. パッケージ構成と依存関係

### 8.1 artifact-contracts の独立性

artifact-contracts は agent-contracts / agent-contracts-runtime に依存しない独立パッケージとする。「エージェントが存在しなくても使える」ことが artifact-contracts の大きな価値であり、中核処理を agent-contracts-runtime に置くと概念上の依存が逆転する。

```text
artifact-contracts (standalone)
  ├─ core/
  │   ├─ schema.ts        # Zod schema
  │   ├─ resolver.ts      # artifact 解決
  │   ├─ matcher.ts       # glob matcher
  │   ├─ manifest.ts      # manifest model
  │   ├─ drift-runner.ts  # drift 実行
  │   └─ lookup.ts        # path → artifact ID 逆引き
  ├─ cli/
  │   ├─ validate.ts
  │   ├─ list.ts
  │   ├─ explain.ts
  │   ├─ drift.ts
  │   ├─ coverage.ts
  │   ├─ manifest.ts
  │   ├─ import.ts
  │   ├─ export.ts
  │   └─ plan.ts
  └─ export/
      ├─ policy-json.ts
      ├─ agent-contracts.ts
      └─ guardrails.ts
```

### 8.2 agent-contracts-runtime の役割

agent-contracts-runtime は、エージェント実行時コンテキストに artifact 情報を渡す薄い統合レイヤーのみを提供する:

```typescript
import { resolveAgentContext } from "agent-contracts-runtime";

const context = await resolveAgentContext({
  agentContracts: "./agent-contracts.yaml",
  artifactSource: "./artifact-contracts.yaml",
});
```

artifact DSL 自体の parse / validate / resolve は artifact-contracts のエクスポートを利用する:

```typescript
import { loadArtifactContracts, resolveArtifact } from "artifact-contracts/core";

const ac = await loadArtifactContracts("./artifact-contracts.yaml");
const info = resolveArtifact(ac, "contracts/billing/index.ts");
```

---

## 9. 各ツールへの影響

### 9.1 ツール内部の変更

各 LLM 対応 CLI ツールの `dsl/artifacts.yaml` に、ツールが管理するファイルの物理的定義を追加する。`team_interface.exposes.artifacts` で外部公開する artifact を宣言する。

| ツール | 内部 DSL に追加する artifact | 外部公開 |
|---|---|---|
| micro-contracts | `api-contracts-generated`, `api-specs-source`, `api-overlays` | 全て |
| speckeeper | `design-specs`, `spec-definitions` | 全て |
| embedoc | `doc-markers`, `renderers` | `doc-markers` |
| litedbmodel-gen | `model-columns`, `schema-source` | `model-columns` |
| migraguard | `migration-files`, `lint-results` | `migration-files` |

### 9.2 `artifacts` コマンドの実装

各ツールに `artifacts` サブコマンドを追加。内部 DSL + ツール config からパスを解決して JSON/YAML を出力する。

### 9.3 micro-contracts.guardrails.yaml の位置づけ

artifact-contracts の導入後:

- `generated` → artifact-contracts で管理（`authority: generated`）
- `protected` → artifact-contracts で管理（`change_control: approval-required` または `authority: canonical`）
- `allowed` → プロジェクト全体のスコープは artifact-contracts に移管。micro-contracts guardrails は API 契約スコープのみに縮小
- `checks` → 個別ツールの gate として引き続き micro-contracts が管理。artifact-contracts の `drift` コマンドからも呼び出し可能

---

## 10. 実装ロードマップ

### Phase 0: artifact-contracts DSL 設計 (この文書)

- DSL スキーマの確定
- CLI コマンドの確定
- agent-contracts / cli-contracts との連携インターフェースの確定

### Phase 1: artifact-contracts core

CLI より先に core を固める。

1. Zod schema
2. config 変数展開（`${vars.*}` + 配列 flatten）
3. resolver（デフォルト展開含む）
4. glob matcher
5. artifact lookup by path
6. source/output relation model
7. manifest model

### Phase 2: 最小 CLI

drift より前に `explain` を実装する。drift 実行は副作用・実行環境・速度の問題がある一方、`explain` は台帳としてすぐに価値が出る。

1. `validate` コマンド
2. `resolve` コマンド
3. `list` コマンド
4. `explain` コマンド
5. `coverage` コマンド

### Phase 3: drift / manifest

1. `drift` コマンド
2. `manifest` 生成
3. `manifest --verify`
4. strategy 実装（manifest, command-exit-code）

### Phase 4: export

1. `export --format policy-json`
2. `export --format agent-contracts`
3. `export --format guardrails`

### Phase 5: import / ツール artifact プロトコル

1. cli-contracts リファレンスに `artifacts` コマンドパターンを追加
2. 各ツールの `artifacts` コマンド実装
3. `import` コマンド（conflict policy 付き）
4. merge policy の実装

### Phase 6: agent-contracts 連携

artifact-contracts core の安定後に組み込む。暫定仕様が agent-contracts 側に漏れるのを防ぐ。

1. `artifact_source` フィールドの追加と resolve 処理
2. `x-path-patterns` 等の既存 extension との後方互換性
3. `generate guardrails` で artifact-contracts の情報を利用した policy.json 生成

### Phase 7: LLM コマンド統合

1. `plan` コマンド
2. 各ツールの LLM コマンド（audit / propose / explain）の実装
3. `audit guardrails` で artifact-contracts を活用
4. drift チェック結果を LLM コンテキストに含める

---

## 11. 設計判断の根拠

### 11.1 なぜ agent-contracts 内の拡張ではなく分離か

1. **単一責任**: artifact ライフサイクル管理（drift、manifest、coverage）と agent team 管理は独立した関心事
2. **エージェント不要でも使える**: LLM 未導入プロジェクトでも artifact-contracts 単体でファイルガバナンスが機能する
3. **`*-contracts` ファミリーの一貫性**: cli-contracts が CLI メタデータを分離しているのと同じ設計パターン
4. **drift check の所在**: 各ツールの個別 drift + プロジェクト横断 drift が artifact-contracts に一本化される
5. **micro-contracts.guardrails.yaml の正統な後継**: プロジェクト全体のファイルガバナンスを担う専用ツールとして位置づけ

### 11.2 なぜ既存の extension (`x-path-patterns` 等) を正式フィールドにするか

- `x-` prefix は「拡張」であり、ツール固有の ad-hoc な追加という位置づけ
- artifact のパスパターンや authority はファイルガバナンスの本質であり、拡張ではなくコア概念
- 正式フィールドにすることで、スキーマバリデーション、ドキュメント生成、ツール間の互換性が保証される

### 11.3 なぜ artifact-contracts を独立パッケージにするか

- artifact の解決・drift 実行は agent workflow とは独立した関心事であり、agent-contracts-runtime に依存すべきでない
- 「エージェントが存在しなくても使える」ことが artifact-contracts の大きな価値
- 依存方向は `agent-contracts → artifact-contracts` であり、逆ではない
- agent-contracts-runtime は薄い統合レイヤーとして artifact 情報をエージェントコンテキストに渡す役割に限定する

### 11.4 既存プロジェクトからの移行パス

1. artifact-contracts.yaml を作成し、既存の `x-path-patterns` 等から artifact 定義を移行
2. agent-contracts に `artifact_source` を追加
3. `x-path-patterns` 等は後方互換で引き続き動作（`artifact_source` 未指定時）
4. micro-contracts.guardrails.yaml の `allowed` を段階的に縮小
5. CI に `artifact-contracts drift` を追加

---

## 12. 未決定事項

### 解決済み

1. ~~**パッケージ名**~~: `artifact-contracts` で確定
2. ~~**agent-contracts-runtime への artifact 機能の配置**~~: artifact-contracts 自体が core / CLI / export を持つ独立パッケージとする
3. ~~**バージョニング**~~: `artifactContracts: 0.1.0` 形式で semver を採用（Document Version とは独立）
4. ~~**region scope のネスト**~~: region artifact のオーナーは単一のツールチェイン。外部プログラムによる編集は許容し、drift チェック・整合性検証はオーナーのツールチェインが責任を持つ（3.4 節参照）
5. ~~**dynamic scope の coverage 計算**~~: config 変数（`${vars.*}`）による静的解決で対応。変数展開後は通常の glob パターンになるため、coverage 計算は確定的に実行可能
6. ~~**変数展開構文**~~: `${vars.*}` を採用（agent-contracts と統一）。配列変数の flatten ルール含む（3.1 節参照）
7. ~~**manifest strategy と外部コマンドの関係**~~: `manifest` は内蔵検証に限定。外部ツールは `command-exit-code` を使用（3.6 節参照）
8. ~~**drift 修復コマンドの所在**~~: `repair` フィールドとして DSL に追加（3.10 節参照）
9. ~~**directory scope**~~: 初期版では不要。`file` + glob で代替可能（3.4 節参照）
10. ~~**artifact ID 命名規則**~~: kebab-case（`[a-z0-9-]+`）。ドット区切りは将来の namespace 拡張用に予約（3.9 節参照）

### 未解決

1. **DSL の詳細スキーマ**: `scope.path_patterns` の negation（`!pattern`）サポート
2. **CLI の実装言語**: TypeScript（他の contracts と同様）で確定するか
3. **CI テンプレート**: GitHub Actions 等の CI ワークフローテンプレートの提供範囲
