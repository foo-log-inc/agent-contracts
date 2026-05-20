# agent-contracts: Navigation Index & Binding Resolution 改修案

**Status**: Draft
**Date**: 2026-05-20

---

## 1. 概要

agent-contracts に **Project Navigation Index** コマンドと **Binding Resolution Model** を導入する。

Navigation Index は、artifact を起点に「誰が何をどう扱うか」を逆引きできる runtime-readable model であり、既存の `generate` コマンド（runtime/editor 向けファイル生成）とは別の責務を持つ。

Binding Resolution Model は、cli-contracts のドメイン非依存スロットとプロジェクト固有 artifact ID を結ぶ仕組みであり、Navigation Index の入力データとなる。

---

## 2. 責務分離

```text
artifact-contracts (standalone DSL)
  - artifact ID / path_patterns / authority / manual_edit / change_control
  - state / check result (optional)
  - CLI / agent を知らない

cli-contracts (standalone DSL)
  - command / args / options / stdout / stderr
  - artifact_slots（ドメイン非依存の抽象スロット）
  - effects（command → slot の read/write 関係）
  - project artifact ID を知らない

agent-contracts (integration DSL)
  - agents / tasks / workflows / handoffs
  - tools（= 利用方法単位の tool 定義）
  - artifact imports（$ref で artifact-contracts を取り込み）
  - artifact_bindings（スロット → artifact ID）
  - permissions / guardrails / validations
  - navigation-index コマンド（compile 相当）

generate（既存コマンド）
  - Cursor rules/hooks, Claude Code CLAUDE.md/skills, prompt files
  - navigation-index を入力にできる

navigation-index（新規コマンド）
  - artifact 起点の逆引き index
  - runtime / planner / guardrail が読む構造化モデル
```

### 依存方向

```text
artifact-contracts ┐
                   ├─ agent-contracts（統合レイヤ）
cli-contracts ─────┘
                        │
                        ├─ navigation-index（queryable model）
                        │
                        └─ generate（file output）
                              └─ runtime-binding (Cursor / Claude Code / CI)
```

---

## 3. Tool = 利用方法単位

### 3.1 設計原則

tool ID は「CLI パッケージ名」ではなく「プロジェクト内でのツールの具体的な利用方法」を表す。同じ CLI でも対象 artifact が異なれば別 tool ID。

### 3.2 config base tool + extends パターン

config ファイル内で設定されている artifact の対応関係（暗黙のスロット binding）を、DSL 上で明示するために **config base tool** を定義し、各コマンド tool が `extends` で継承する。

```yaml
tools:
  # ─── config base: config ファイル由来の binding を明示する ───
  speckeeper-base:
    kind: cli
    cli_contract: speckeeper
    artifact_bindings:
      spec-source: design-dir        # config の models.path に対応
      design-models: design-dir      # config の models に対応
      implementation-source: codebase
      test-source: test-code
      config: speckeeper-config      # config ファイル自体

  micro-contracts-base:
    kind: cli
    cli_contract: micro-contracts
    artifact_bindings:
      source-specs: contracts        # config の specs に対応
      overlays: contracts-overlays   # config の overlays に対応
      config: micro-contracts-config
      routes-output: routes-generated
      service-api-output: service-api-generated
      view-props-output: view-props-generated
      manifest-output: generated-manifest

  eslint-base:
    kind: cli
    cli_contract: eslint
    artifact_bindings:
      config: eslint-config

  # ─── 利用方法単位の tool: extends で base を継承し、コマンド固有の binding を追加/上書き ───
  speckeeper-lint:
    extends: speckeeper-base
    command: lint
    # artifact_bindings は base から継承（lint は spec-source + design-models を使う）

  speckeeper-check-impl:
    extends: speckeeper-base
    command: check
    # artifact_bindings は base から継承（check は spec-source + design-models + implementation-source を使う）

  speckeeper-test-coverage:
    extends: speckeeper-base
    command: test:coverage
    # artifact_bindings は base から継承（test:coverage は spec-source + test-source を使う）

  eslint-frontend:
    extends: eslint-base
    command: lint
    artifact_bindings:
      target-source: frontend-code   # base を上書き: frontend 用

  eslint-server:
    extends: eslint-base
    command: lint
    artifact_bindings:
      target-source: server-code     # base を上書き: server 用

  micro-contracts-pipeline:
    extends: micro-contracts-base
    command: pipeline
    # artifact_bindings は base から全て継承
```

この設計のポイント:
- **config base tool**: config ファイルで設定される全スロットの binding を一箇所に宣言
- **extends**: 各コマンド tool は base を継承し、コマンド固有の上書きのみ記述
- **二重定義だが明示的**: config の中身と DSL の対応が追跡可能
- **解決ロジックを cli-contracts に持ち込まない**: 優先順位は agent-contracts 側で extends + override で表現

### 3.3 既存 reads/writes との関係

現行の commands 内 `reads`/`writes` は cli-contract 未導入時の手書き代替。

- `cli_contract` + `artifact_bindings` がある tool → reads/writes は navigation-index 生成時に自動導出
- `cli_contract` がない tool → 従来通り手書き reads/writes を使用（後方互換）

---

## 4. cli-contract 側: artifact_slots

### 4.1 宣言

cli-contract は `artifact_slots` でツールが扱う artifact のインターフェースを宣言する。cli-contract 側はスロットの名前・説明・方向のみを定義し、解決方法（config or 引数）は関知しない。

```yaml
# cli-contract.yaml (speckeeper)
artifact_slots:
  spec-source:
    description: "Specification files to lint/verify"
    direction: read
  design-models:
    description: "Design model definitions"
    direction: read
  implementation-source:
    description: "Source code for annotation/traceability check"
    direction: read
  test-source:
    description: "Test files for coverage check"
    direction: read
  target-file:
    description: "Single file to verify (CLI argument)"
    direction: read
```

- `direction`: `read` | `write` | `readwrite`
- スロットがどう供給されるか（config / argument / 環境変数）は cli-contract の責務外
- agent-contracts 側の `artifact_bindings`（config base tool + extends）で具体化する

### 4.2 commands の effects

```yaml
commands:
  lint:
    effects:
      reads: [spec-source, design-models]
      writes: []
  check:
    effects:
      reads: [spec-source, design-models, implementation-source]
      writes: []
  verify:
    effects:
      reads: [target-file]
      writes: []
```

effects の reads/writes は artifact_slots のスロット名を参照する。

---

## 5. Binding Resolution

### 5.1 解決チェーン

| 層 | 責務 | 例 |
|---|---|---|
| cli-contract `artifact_slots` | スロット宣言（名前と方向のみ） | `spec-source: { direction: read }` |
| agent-contracts config base tool | config 由来の binding（デフォルト） | `spec-source: design-dir` |
| agent-contracts extends tool | コマンド固有の上書き（ある場合のみ） | `target-source: frontend-code` |
| artifact-contracts | artifact ID → path_patterns | `design-dir: { path_patterns: ["design/**"] }` |
| tool config ファイル | 物理パス設定（実装詳細） | `models: [{ path: "design/" }]` |

解決の流れ:
1. cli-contract がスロットを宣言（抽象インターフェース）
2. config base tool が全スロットのデフォルト binding を設定（= config 内容の DSL 表現）
3. extends した各コマンド tool が必要に応じて上書き
4. 最終的な artifact ID は artifact-contracts の path_patterns で物理パスに解決

### 5.2 reads/writes の導出

navigation-index 生成時に以下のアルゴリズムで依存グラフを構築する:

```
for each tool in agent-contracts.tools:
  if tool.cli_contract exists:
    cli = load(tool.cli_contract)
    effects = cli.commands[tool.command].effects
    for slot in effects.reads:
      artifact_id = tool.artifact_bindings[slot]
      graph.add_edge(tool.id, artifact_id, "reads")
    for slot in effects.writes:
      artifact_id = tool.artifact_bindings[slot]
      graph.add_edge(tool.id, artifact_id, "writes")
  else:
    # Fallback: 手書き reads/writes
    for artifact_id in tool.commands[*].reads:
      graph.add_edge(tool.id, artifact_id, "reads")
    for artifact_id in tool.commands[*].writes:
      graph.add_edge(tool.id, artifact_id, "writes")
```

### 5.3 config の位置づけ

config ファイルは `artifact_bindings` の物理的実現であり、config 自体も artifact として定義する:

```yaml
artifacts:
  speckeeper-config:
    type: config
    authority: control
    path_patterns: ["speckeeper.config.ts"]
  micro-contracts-config:
    type: config
    authority: control
    path_patterns: ["micro-contracts.config.yaml"]
```

#### config base tool で config → slot 対応を明示する

config 内で設定されている項目が「どのスロットにどの artifact をバインドしているか」は、config base tool の `artifact_bindings` で明示する（セクション 3.2 参照）。

```text
config base tool の artifact_bindings
  = config ファイルの設定内容を DSL 上で表現したもの
  = スロット解決の「デフォルト値」

extends した各コマンド tool
  = コマンド固有の上書き（ある場合のみ）
```

この方式により:
- config 内の暗黙的な binding が DSL 上で追跡可能になる
- tool 呼び出し時のスロット解決ロジック（config vs 引数の優先順位）を cli-contracts に持ち込む必要がない
- agent-contracts の既存 extends / merge 機構と一貫する

---

## 6. Navigation Index コマンド

### 6.1 CLI インターフェース

```bash
agent-contracts navigation-index -c agent-contracts.config.yaml
agent-contracts navigation-index --format json
agent-contracts navigation-index --artifact api-contracts
agent-contracts navigation-index --path contracts/generated/client.ts
agent-contracts navigation-index --explain
```

### 6.2 generate との違い

| コマンド | 出力 | 消費者 |
|---|---|---|
| `generate` | ファイル（.md, .sh, hooks, rules） | 人間、エディタ、CI |
| `navigation-index` | 構造化モデル（JSON/YAML） | runtime, planner, guardrail, governance |

### 6.3 Navigation Index が答える問い

```text
この path はどの artifact か
この artifact は直接編集できるか
この artifact は何から生成されるか
この artifact を生成する tool は何か
この artifact を検証する tool は何か
この artifact に作用できる agent は誰か
この artifact が変わったとき影響を受ける artifact は何か
この artifact を current にするには何を実行するか
```

---

## 7. Navigation Index 出力スキーマ

### 7.1 トップレベル

```ts
type ProjectNavigationIndex = {
  version: string;
  generated_at: string;
  system: { id: string; name: string };  // agent-contracts DSL の system セクションから取得
  artifacts: Record<string, CompiledArtifactNode>;
};
```

`system` は agent-contracts の既存 `SystemSchema`（`id`, `name`）をそのまま使用する。

### 7.2 CompiledArtifactNode

```ts
type CompiledArtifactNode = {
  id: string;
  files: {
    path_patterns: string[];
    exclude_patterns: string[];
  };
  properties: {
    type: string;
    authority: "canonical" | "derived" | "generated" | "control";
    manual_edit: "allowed" | "discouraged" | "forbidden";
    change_control: "none" | "approval-required" | "regeneration-required";
  };
  relations: {
    source_artifacts: string[];
    derived_artifacts: string[];
  };
  operations: {
    producers: ArtifactOperation[];
    validators: ArtifactOperation[];
    consumers: ArtifactOperation[];
  };
  agents: {
    owners: string[];      // own_artifacts に含む agent
    editors: string[];     // can_write_artifacts に含む agent
    readers: string[];     // can_read_artifacts に含む agent
  };
  routes: {
    update?: ArtifactRoute[];
    regenerate?: ArtifactRoute[];
    validate?: ArtifactRoute[];
  };
};

type ArtifactOperation = {
  tool: string;            // tool ID (= 利用方法単位)
  cli_contract: string;    // パッケージ参照
  command: string;
  slot: string;            // この artifact にバインドされたスロット名
  invokable_by: string[];  // この tool を実行できる agent
};
```

operation を artifact 内にインラインすることで、「この artifact に対して何ができるか」を artifact 単体で完結して取得できる。トップレベルの operations セクションは不要。

### 7.3 ArtifactRoute

```ts
type ArtifactRoute = {
  purpose: "update" | "regenerate" | "validate";
  steps: ArtifactRouteStep[];
};

type ArtifactRouteStep =
  | { type: "edit_artifact"; artifact: string; candidate_agents: string[] }
  | { type: "run_operation"; operation: string; candidate_agents: string[] }
  | { type: "request_review"; artifact: string; candidate_agents: string[] };
```

---

## 8. routing の例

### 8.1 generated artifact を直接編集しようとした場合

```text
attempted edit: contracts/generated/client.ts
  ↓ path lookup
artifact: api-contracts (authority: generated, manual_edit: forbidden)
  ↓ navigation-index
source_artifacts: [api-specs]
producer: micro-contracts-pipeline
  ↓ routing response
{
  "decision": "block_and_reroute",
  "target_artifact": "api-contracts",
  "route": {
    "steps": [
      { "type": "edit_artifact", "artifact": "api-specs", "candidate_agents": ["api-designer"] },
      { "type": "run_operation", "operation": "micro-contracts-pipeline", "candidate_agents": ["contract-maintainer"] },
      { "type": "run_operation", "operation": "micro-contracts-check-drift", "candidate_agents": ["contract-maintainer"] }
    ]
  }
}
```

### 8.2 navigation-index を入力にした generate

```text
agent-contracts navigation-index
  ↓
navigation-index.json
  ↓
agent-contracts generate (runtime-binding)
  ↓
.cursor/rules/artifact-protection.mdc    (generated file 編集禁止 + 誘導メッセージ)
.cursor/hooks/artifact-routing.sh        (path → artifact → route の実行)
CLAUDE.md                                (artifact routing context)
```

---

## 9. 検証ルール（lint/audit）

| ルール | 内容 |
|---|---|
| binding-completeness | artifact_bindings が cli-contract command の effects で参照される全スロットをカバーしているか |
| binding-artifact-exists | artifact_bindings の値が artifacts セクションに存在するか |
| binding-direction-match | write スロットにバインドされた artifact を、tool を実行する agent が can_write_artifacts に持つか |
| config-path-consistency | config artifact の path_patterns と、バインドされた artifact の path_patterns が整合するか |
| slot-declaration-exists | artifact_bindings のキーが cli-contract の artifact_slots に宣言されているか |

---

## 10. 移行戦略

### Phase A: スキーマ準備（完了 — v0.25.0）

- ToolSchema に `cli_contract`, `artifact_bindings` フィールド追加済み
- AgentSchema に `own_artifacts` 追加済み

### Phase B: Tool 定義の再設計

- 既存の「1 tool = 1 CLI パッケージ、commands 複数」を「1 tool = 1 利用方法」に分割
- 既存 commands の reads/writes は後方互換で残す
- `cli_contract` + `command` + `artifact_bindings` が指定された tool は新モデル

### Phase C: cli-contract 側の artifact_slots 追加

- 各 cli-contract パッケージ（speckeeper, micro-contracts, migraguard 等）に `artifact_slots` を追加
- commands.effects が artifact_slots のスロット名を参照する形に更新

### Phase D: navigation-index コマンド実装

- binding resolution アルゴリズムの実装
- CompiledArtifactNode / CompiledOperationNode の生成
- route 推論ロジック（source_artifacts → producer → validator のチェーン構築）
- CLI: `agent-contracts navigation-index`

### Phase E: generate との統合

- navigation-index 出力を generate のテンプレートコンテキストに注入
- artifact-aware guardrail / routing hook の生成

---

## 11. 非目的

navigation-index は以下を行わない:

- workflow の実行
- agent の直接起動
- CLI の直接実行
- state の記録・管理（state ledger は別機能）
- trigger の発火

これらは governance layer / agent runtime の責務である。

---

## 12. 将来の分離

中期的に agent-contracts の内部は以下に分離可能:

```text
agent-contracts-core
  - agent / team behavior definition
  - task / workflow / handoff / guardrail

project-navigation (or integration-contracts)
  - artifact imports
  - cli imports
  - artifact_bindings
  - navigation-index
  - runtime model
```

ただし今は分離せず、agent-contracts 内に統合機能として置く。仕様が安定した後に切り出す。

---

## 13. 未決定事項

1. `cli_contract` の参照形式: パッケージ名 or ファイルパス or npm resolve
2. config base tool の命名規約: `{package}-base` / `{package}-config` / 自由
3. tool ID の命名規約: `{package}-{command}` / `{package}-{purpose}` / 自由
4. navigation-index の出力形式: JSON only or YAML も対応
5. route 推論のルール: source_artifacts の自動推定（generated authority → 何が source か）
6. state ledger との統合タイミング
7. config base tool は実行可能 tool か、純粋な binding テンプレートか（kind: template ?）
