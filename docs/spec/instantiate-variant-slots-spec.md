# $clone 仕様

> **Status**: Proposal
> **Created**: 2026-06-05
> **目的**: エージェント定義の variant 生成（`$clone`）を agent-contracts DSL に追加し、
> **実行時 fanout なしで LLM が `purpose` + `can_read/write_artifacts` ベースで
> 委譲先を選択する**モデルを実現する。
> **関連**: `docs/spec/artifact-binding-spec.md`, `docs/spec/guardrail-di.md`

---

## 1. 設計原則

### 1.1 前提（runtime 制約）

- **実行時 fanout は行わない**。runtime の `candidate-agents.ts` / `task-runner.ts` はそのまま。
- variant は **resolve 時に完全な並列定義として展開**される。runtime から見れば通常の agents/tasks。
- LLM は登録された agents の `purpose` + `can_read/write_artifacts` を見て自動委譲する。

### 1.2 用語

| 用語 | 定義 |
|------|------|
| **base** | `$clone` の `from` で参照される既存エンティティ定義（オブジェクト） |
| **variant** | `$clone` の解決結果として生成されるエンティティ（別 ID） |
| **binding** | artifact-contracts.yaml の具象データで DSL の artifact 定義を上書きする処理 |
| **resolve** | `$clone` を展開し通常の定義に変換する静的処理 |

### 1.3 設計判断

| 判断 | 根拠 |
|------|------|
| fanout という概念を出さない | runtime 変更不要。LLM の description ベース委譲で十分 |
| `$clone` は resolve 時オペレーター | runtime 機能ではない。tool `extends` と同じ resolve 時処理 |
| `$clone`（not `$instantiate`）| base はクラスではなく既存オブジェクト。「コピーして差分適用」が正確 |
| variant は完全な定義として emit | resolve 後は通常の agents/tasks — runtime に variant 概念は不要 |
| 新規スキーマフィールド不要 | `purpose` + `can_read/write_artifacts`（既存フィールド）で LLM は委譲先を判断できる |

---

## 2. `$clone` オペレーター

### 2.1 概要

base 定義をコピーし、差分を merge し、別 ID の定義として emit する **resolve 時オペレーター**。
`tool.extends`（`src/resolver/tool-extends.ts`）の一般化だが、エンティティを上書きするのではなく
**新規 ID で追加する**点が異なる。

base はクラスやテンプレートではなく**既存の具象オブジェクト**であるため、`$instantiate` ではなく
`$clone` を採用する。操作の実態は「オブジェクトのディープコピー + 差分マージ」である。

### 2.2 適用対象

map 型の全 top-level セクションに適用する。`$clone` は「コピーして差分マージ」する汎用操作
であり、特定のエンティティに限定する理由がない。

| セクション | 備考 |
|------------|------|
| `agents` | 主要ユースケース（agent variant） |
| `tasks` | task variant（同じ workflow で異なる成果物を扱う） |
| `artifacts` | artifact variant（同じ type で domain が異なる） |
| `tools` | `tool.extends`（継承・上書き）とは別用途（別 ID で新規 emit）。共存可 |
| `guardrails` | guardrail variant（同じ scope で severity/action が異なる） |
| `handoff_types` | handoff variant |
| `workflow` | workflow variant |

### 2.3 構文

```yaml
agents:
  <new-id>:
    $clone:
      from: <base-entity-id>     # 必須。同一セクション内の既存 ID
      merge:                     # 任意。差分フィールド
        <field>: <value>         #   スカラー: 上書き
        <field>:                 #   配列/マップ: merge operator 使用可
          $append: [...]
```

#### フィールド定義

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `from` | `string` | Yes | コピー元の base エンティティ ID。同一セクション（`agents` / `tasks` / `artifacts`）内に存在すること |
| `merge` | `object` | No | base にマージする差分フィールド。省略時は base の完全コピー |

- `merge` 内では既存の merge operator（`$append`, `$prepend`, `$insert_after`, `$replace`, `$remove`）が使用可能。
- `merge` 内のスカラーフィールドは base を上書きする。
- `merge` 内のオブジェクトフィールドは `deepMergeEntities` と同じセマンティクスで再帰マージする。

### 2.4 解決セマンティクス

```text
resolveClone(entities: Record<string, Entity>):
  1. entries を走査し、$clone を持つ entry を収集
  2. 各 entry について:
     a. from で指定された base を lookup（base 自体も $clone の場合は先に解決 — 依存順）
     b. base が見つからない → CloneError
     c. base をディープコピー
     d. merge があれば deepMergeEntities(copy, merge, path, hasExtends=true) を適用
     e. $clone キーを削除
     f. 結果を new-id で entities に配置
  3. 循環参照 → CloneError
```

#### 既存 merge operator との関係

`$clone.merge` 内での merge operator 使用は、top-level `extends` の有無に関わらず許可する。
`$clone` 自体が「base をコピーして差分適用する」意味であり、`hasExtends=true` として扱う。

これは `tool.extends` が top-level `extends` なしでも機能するのと同じ設計。

### 2.5 resolve パイプラインへの配置

```text
既存:
  loadDsl → resolveExtendsChain → resolveToolExtends → substituteVars → expandDefaults

提案:
  loadDsl → resolveExtendsChain → resolveClone → resolveToolExtends → substituteVars → expandDefaults
                                  ^^^^^^^^^^^^
                                  新規フェーズ
```

`resolveExtendsChain` の後（= 全 base 定義が確定済み）、`resolveToolExtends` の前に配置する。
`resolveClone` は map 型の全 top-level セクションに対して適用する。

### 2.6 例

#### 入力（resolve 前）

```yaml
agents:
  implementer:
    role_name: Implementer
    purpose: "General-purpose implementer"
    mode: read-write
    can_write_artifacts: [openapi-spec, api-handler]
    responsibilities:
      - "Implement changes safely"
    rules:
      - id: R-IMPL-001
        description: "Preserve existing structure"
        severity: mandatory
    can_execute_tools: [Read, Edit, Write]

  implementer.api_contract:
    $clone:
      from: implementer
      merge:
        purpose: "Implementer specialized for API contract changes"
        can_write_artifacts:
          $replace: [openapi-spec]
        can_read_artifacts: [api-handler, api-test]
        responsibilities:
          $append:
            - "Preserve backward compatibility"
            - "Validate schema changes"
        rules:
          $append:
            - id: R-IMPL-API-001
              description: "Validate backward compatibility of API schema changes"
              severity: mandatory
```

#### 出力（resolve 後）

```yaml
agents:
  implementer:
    role_name: Implementer
    purpose: "General-purpose implementer"
    mode: read-write
    can_write_artifacts: [openapi-spec, api-handler]
    responsibilities:
      - "Implement changes safely"
    rules:
      - id: R-IMPL-001
        description: "Preserve existing structure"
        severity: mandatory
    can_execute_tools: [Read, Edit, Write]

  implementer.api_contract:
    role_name: Implementer
    purpose: "Implementer specialized for API contract changes"
    mode: read-write
    can_write_artifacts: [openapi-spec]
    can_read_artifacts: [api-handler, api-test]
    responsibilities:
      - "Implement changes safely"
      - "Preserve backward compatibility"
      - "Validate schema changes"
    rules:
      - id: R-IMPL-001
        description: "Preserve existing structure"
        severity: mandatory
      - id: R-IMPL-API-001
        description: "Validate backward compatibility of API schema changes"
        severity: mandatory
    can_execute_tools: [Read, Edit, Write]
```

`$clone` は消え、通常の agent 定義だけが残る。runtime から見れば 2 つの独立した agent。
LLM は `purpose` + `can_write_artifacts: [openapi-spec]` を見て委譲先を判断する。

### 2.7 連鎖（chaining）

`$clone` は連鎖可能。variant から更に variant を派生できる。

```yaml
agents:
  implementer.api_contract.billing:
    $clone:
      from: implementer.api_contract
      merge:
        purpose: "Implementer for billing API contract changes"
        can_write_artifacts:
          $replace: [billing-openapi-spec]
        can_read_artifacts:
          $replace: [billing-api-handler, billing-api-test]
```

解決順序は依存グラフの位相ソートで決定する。循環は `CloneError`。

### 2.8 制約

| 制約 | 根拠 |
|------|------|
| `from` は同一セクション内の ID | 同一 map セクション内。cross-section は不可 |
| base が `$clone` の場合は先に解決 | 位相ソート。循環は error |
| `merge` 内の `$clone` はネスト不可 | `$clone` は entity 直下のみ |
| resolve 後に `$clone` キーは残らない | runtime に variant 概念は不要 |
| base entity は resolve 後も残る | 削除されない。base 自体も有効な定義 |

### 2.9 エラー

| エラー | 条件 | 重大度 |
|--------|------|--------|
| `CloneError: base not found` | `from` が同一セクション内に存在しない | error |
| `CloneError: circular` | `$clone` チェーンが循環 | error |
| `CloneError: merge conflict` | merge operator が base に存在しないフィールドに適用 | error (MergeError) |

---

## 3. 2 層の resolve パイプライン

### 3.1 既存 resolve（DSL 単体）

```text
loadDsl (Phase 1: $ref/$refs assembly)
  ↓
resolveExtendsChain (top-level extends — file/package merge)
  ↓
resolveClone (NEW — agents/tasks/artifacts の $clone を展開)
  ↓
resolveToolExtends (tools map 内の extends chain)
  ↓
substituteVars (${vars.*} 置換)
  ↓
expandDefaults (optional — Zod defaults を展開)
  ↓
→ Resolved DSL（agent-contracts 単体の完全定義）
```

これは既存の resolve パイプラインに `resolveClone` を追加しただけ。
**DSL 単体で閉じた resolve** であり、プロジェクト固有の具象データは含まない。

### 3.2 Bound resolve（config レベルの全マージ・新規）

Bound resolve は artifact-contracts だけでなく、**config が注入する全プロジェクト固有情報を
統合**した結果を生成する。artifact-contracts が最大の新規追加要素だが、既存の guardrail binding /
paths / policy 解決も同じ層に属する。

```text
Resolved DSL（§3.1 の出力）
  ↓
config レベルの全マージ:
  ├─ artifact_binding (artifact-contracts.yaml で artifacts を上書き)  ← 新規・メイン
  ├─ bindings (SoftwareBinding — guardrail_impl の合成)                ← 既存
  ├─ paths ({var} テンプレート展開)                                      ← 既存
  ├─ active_guardrail_policy (ポリシー選択)                             ← 既存
  └─ (将来: model_mapping 等)
  ↓
→ Bound DSL（プロジェクト固有の完全な resolved DSL）
  ↓
validateSchema → checkReferences → lint → generate / navigation-index
```

Bound resolve の入力と出力:

| | 既存 resolve（DSL 単体） | Bound resolve（config 全マージ） |
|---|---|---|
| 入力 | agent-contracts.yaml (+ extends chain) | Resolved DSL + config 全体（artifact-contracts, bindings, paths, policy, ...） |
| 出力 | Resolved DSL | Bound DSL |
| artifacts の内容 | 抽象定義（type, authority 等）。path_patterns はデフォルト値 | 抽象 + 具象（artifact-contracts で上書き + `{var}` 展開済み） |
| guardrails | 抽象宣言のみ | guardrail_impl と合成済み（`_guardrailRules`） |
| 用途 | DSL の構造検証、lint | SDK adapter、navigation-index、guardrail scope 解決 |

### 3.3 resolveClone の位置の根拠

| 位置 | 根拠 |
|------|------|
| `resolveExtendsChain` の後 | base 定義が file merge で確定している必要がある |
| `resolveToolExtends` の前 | clone で生成された agent が tool の `invokable_by` に現れうる |
| `substituteVars` の前 | `${vars.*}` は clone 後に統一的に展開 |

### 3.4 validate / lint への影響

| 検証 | 変更 |
|------|------|
| `checkReferences` | `$clone` 展開後の agent/task が参照する artifact ID の存在チェック |
| schema validation | 変更なし（既存スキーマのみ使用） |

---

## 4. スキーマ変更サマリー

### 4.1 既存スキーマ変更

| ファイル | 変更 |
|----------|------|
| `src/config/types.ts` | `artifact_binding` フィールド追加（optional） |

### 4.2 resolver 変更

| ファイル | 変更 |
|----------|------|
| `src/resolver/clone.ts` (新規) | `resolveClone()` 実装 |
| `src/resolver/resolve.ts` | パイプラインに `resolveClone` フェーズ追加 |
| `src/resolver/artifact-binding.ts` (新規) | `resolveArtifactBinding()` — artifact-contracts.yaml との合成 |

### 4.3 変更不要

| ファイル | 根拠 |
|----------|------|
| `src/schema/agent.ts` | `can_read/write_artifacts` は既存フィールド |
| `src/schema/artifact.ts` | 既存の `type` / `authority` で分類は十分 |
| `src/schema/task.ts` | `input_artifacts` で artifact を直接参照（既存） |
| `src/schema/dsl.ts` | 新規 top-level セクション追加なし |
| `src/resolver/tool-extends.ts` | tool は `$clone` 対象外 |
| `src/resolver/merger.ts` | 新規セクション追加なし |
| runtime (`task-runner.ts` 等) | resolve 後は通常の定義。runtime 変更不要 |

---

## 5. 検証ルール

### 5.1 `$clone` 検証

| ルール ID | 条件 | 重大度 |
|-----------|------|--------|
| `clone-base-exists` | `from` が同一セクションに存在する | error |
| `clone-no-circular` | `$clone` チェーンが循環しない | error |
| `clone-merge-valid` | `merge` 内の merge operator が base のフィールドに適用可能 | error |

### 5.2 artifact binding 検証（Bound resolve 時）

| ルール ID | 条件 | 重大度 |
|-----------|------|--------|
| `unbound-artifact` | DSL の artifact に対応する artifact-contracts エントリがない | warning |
| `orphan-binding` | artifact-contracts の artifact が DSL に対応 ID を持たない | warning |
| `type-mismatch` | DSL と artifact-contracts で同一 ID の type/authority が矛盾 | warning |

---

## 6. 既存メカニズムとの比較

### 6.1 `$clone` vs top-level `extends`

| 比較軸 | top-level `extends` | `$clone` |
|--------|---------------------|----------|
| スコープ | ファイル全体（DSL 間） | エンティティ単位（セクション内） |
| 用途 | base team の継承 | agent/task/artifact の variant 生成 |
| 結果 | 1 つの merged DSL | 新規 ID のエンティティが追加 |
| base の扱い | base ファイルの内容が project に merge | base エンティティは残る（削除されない） |
| resolve 位置 | パイプライン最初期 | extends 解決後 |
| メタファー | ファイル継承 | オブジェクトのクローン + diff |

### 6.2 `$clone` vs `tool.extends`

| 比較軸 | `tool.extends` | `$clone` |
|--------|----------------|----------|
| 対象 | tools のみ | agents, tasks, artifacts |
| セマンティクス | child が base を継承・上書き | base をコピーし差分 merge して新 ID で emit |
| base の扱い | base は残る | base は残る |
| merge operator | 使用不可（フィールド単位の継承ルール） | 既存 merge operator が使用可 |
| resolve 位置 | `resolveToolExtends` | `resolveClone`（より前） |

---

## 7. 具体例 — 全機能の組み合わせ

### 7.1 DSL（agent-contracts.yaml）

```yaml
version: 1

artifacts:
  openapi-spec:
    type: api-contract
    authority: canonical
    path_patterns: ["specs/**/*.yaml"]     # デフォルト値。binding で上書き可
  api-handler:
    type: implementation
  api-test:
    type: test

agents:
  implementer:
    role_name: Implementer
    purpose: "General-purpose implementer for code changes"
    mode: read-write
    can_execute_tools: [Read, Edit, Write]
    can_write_artifacts: [openapi-spec, api-handler]
    responsibilities:
      - "Implement changes safely"
    rules:
      - id: R-IMPL-001
        description: "Preserve existing code structure"
        severity: mandatory

  implementer.api_contract:
    $clone:
      from: implementer
      merge:
        purpose: "Implementer for API contract changes. Use when writing API contract specifications."
        can_write_artifacts:
          $replace: [openapi-spec]
        can_read_artifacts: [api-handler, api-test]
        responsibilities:
          $append:
            - "Preserve backward compatibility of API contracts"
            - "Validate schema changes against consumers"
        rules:
          $append:
            - id: R-IMPL-API-001
              description: "Validate backward compatibility"
              severity: mandatory

tasks:
  implement_change:
    description: "Implement a requested change to a project artifact"
    target_agent: implementer
    workflow: implement
    input_artifacts: [openapi-spec, api-handler]
    invocation_handoff: task-delegation
    result_handoff: task-result
```

### 7.2 Config（agent-contracts.config.yaml）

```yaml
dsl: ./agent-contracts.yaml
artifact_binding: ./artifact-contracts.yaml
bindings: [./binding.yaml]
paths:
  api_dir: contracts/billing
```

ID が一致しない場合は mappings で明示的に対応付ける:

```yaml
artifact_binding:
  source: ./artifact-contracts.yaml
  mappings:
    openapi-spec: billing_api_contract
    api-handler: billing_api_handler
    api-test: billing_api_test
```

### 7.3 Artifact Registry（artifact-contracts.yaml）

```yaml
schema_version: "2026A"
artifacts:
  billing_api_contract:
    type: api-contract
    authority: canonical
    path_patterns: ["{api_dir}/openapi.yaml"]
    x-domain: billing

  billing_api_handler:
    type: implementation
    authority: canonical
    path_patterns: ["src/billing/api/**/*.ts"]
    x-domain: billing

  billing_api_test:
    type: test
    authority: canonical
    path_patterns: ["tests/billing/api/**/*.test.ts"]
    x-domain: billing
```

### 7.4 Bound resolve 後の artifacts（runtime に渡るもの）

```yaml
artifacts:
  openapi-spec:
    type: api-contract
    authority: canonical
    path_patterns: ["contracts/billing/openapi.yaml"]    # artifact-contracts から上書き + {var} 展開
    x-domain: billing                                     # artifact-contracts から追加
  api-handler:
    type: implementation
    authority: canonical
    path_patterns: ["src/billing/api/**/*.ts"]
    x-domain: billing
  api-test:
    type: test
    authority: canonical
    path_patterns: ["tests/billing/api/**/*.test.ts"]
    x-domain: billing
```

LLM は `implementer.api_contract` の `purpose` + `can_write_artifacts: [openapi-spec]` を見て、
openapi-spec を変更する task が来たときにこの variant に委譲する。

---

## 8. 移行（段階的・非破壊）

| 段階 | 内容 | 影響 |
|------|------|------|
| 1 | `resolveClone` 実装、resolve パイプラインに追加 | `$clone` がなければ no-op |
| 2 | config に `artifact_binding` サポート追加、`resolveArtifactBinding` 実装 | binding-spec と連動 |

---

## 9. 残課題

（現時点でなし）
