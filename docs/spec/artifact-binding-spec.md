# Abstract Artifact Binding — agent-contracts ↔ artifact-contracts 接続仕様

> **Status**: Proposal (v2)
> **Updated**: 2026-06-05
> **目的**: 「汎用 agent-contracts DSL の artifact 定義をデフォルト値とし、artifact-contracts.yaml
> の具象データで上書きして binding で結合する」を、**既存のガードレイル binding と同じ流れ**で実現する具体仕様。
> **v2 変更点**: `$clone` の導入に伴い全面改訂。fanout モデルを廃止し、resolve 時
> variant 生成 + LLM 委譲モデルに移行。binding モデルを簡略化（単一の `artifact_binding`）。
> agent-contracts 中の artifact は既に抽象化されており、実体は config レベルで
> artifact-contracts と binding により解決する。
> **関連**: `artifact-contracts/traceability-proposal.md`, `SoftwareBinding` / guardrail-generator,
> `docs/spec/instantiate-variant-slots-spec.md`

---

## 1. 参照モデル — ガードレイル binding の実装分析（検証済み）

agent-contracts の実装を読むと、ガードレイルは **4 つの関心事**に分離されている。これが
artifact にも適用すべきテンプレート。

### 1.1 抽象宣言（DSL・汎用）— `src/schema/guardrail.ts`

```ts
GuardrailSchema = {
  description: string;
  scope: { agents?, tasks?, tools?, artifacts?, workflows? };  // ← すべて「ID 配列」= 抽象参照
  rationale?, tags, exemptions?
}
```

ガードレイル定義は **intent と抽象 scope（artifact ID 等）だけ**を持ち、具象パスや正規表現を
持たない。

### 1.2 ポリシー（DSL・汎用）— `GuardrailPolicySchema`

```ts
GuardrailPolicyRule = { guardrail: string; severity; action; allow_override; ... }
```

「どの guardrail を どの severity/action で強制するか」の決定。これも抽象。

### 1.3 具象 binding（プロジェクト固有）— `src/schema/binding.ts` `SoftwareBinding`

```ts
SoftwareBinding = {
  software: string; version: 1; extends?: string;
  guardrail_impl?: Record<guardrailId, { checks: Check[] }>;  // ← 抽象 guardrail の具象実装
  outputs?: Record<name, BindingOutput>;                       // target に "{var}" テンプレート
  renders?, reporting?
}
Check = { matcher?: command_regex | content_regex | file_glob; script?; message? }
```

抽象 guardrail ID に対して、**具体的な matcher（正規表現・glob）や script** を与えるのは
binding 側。

### 1.4 解決（合成）— `src/guardrail-generator/resolve-checks.ts` / `resolve-paths.ts`

```ts
resolveChecks(dsl, binding, policy):
  for (guardrailId, impl) of binding.guardrail_impl:
    guardrail = dsl.guardrails[guardrailId]     // 抽象 intent + scope
    policyRule = policy.rules.find(guardrail==id) // 強制決定
    → ResolvedCheck { guardrail_id, guardrail, policy_rule, check }  // 合成

resolveBindingTargetPath(target, config.paths, software):
  target.replace("{var}", config.paths[var])    // 具象パスは config.paths から注入
```

`SoftwareBinding` は `extends`（パッケージ / 相対パス）で合成可能（`binding-loader.ts`）。

### 1.5 抽出される原則

```text
DSL        : intent + 抽象 ID 参照（具象を持たない）
Policy     : 強制決定（severity / action）
Binding    : 抽象 ID → 具象実装（matcher / path / template）
config.paths: 具象パス変数の注入点
Resolver   : DSL × Binding × Policy を ID 一致で合成
```

**ID 一致で合成する**のが鍵。`guardrail_impl` のキーは DSL の guardrail ID。

---

## 2. 現状の非対称（これが問題）

agent / tool / guardrail は **既に artifact を抽象 ID で参照している**:

| 参照元 | フィールド | 値 | 所在 |
|--------|-----------|----|----|
| Agent | `own_artifacts` / `can_read_artifacts` / `can_write_artifacts` | artifact ID 配列 | `schema/agent.ts` |
| Tool | `input_artifacts` / `output_artifacts` / `artifact_bindings` | artifact ID（と slot→ID） | `schema/tool.ts` |
| Guardrail | `scope.artifacts` | artifact ID 配列 | `schema/guardrail.ts` |

**ところが artifact の定義そのものが具象を含んでいる** — `schema/artifact.ts`:

```ts
ArtifactSchema = {
  type; authority?; required_validations; guardrails?; producers; consumers; editors;
  path_patterns?: string[];      // ← 具象（プロジェクト固有）
  exclude_patterns?: string[];   // ← 具象
}
```

ガードレイルは具象（matcher/path）が **binding 側**にあるのに、artifact は具象（path_patterns）が
**DSL 側**にある。この**非対称**が「どこまでが汎用 agent-contracts DSL か」を不透明にしている。

---

## 3. 提案① — DSL 側の整理

### 3.1 既存 `artifacts:` はデフォルト値として維持

agent-contracts DSL の `artifacts:` セクションは**そのまま使う**。既存の `path_patterns` 等の
フィールドも後方互換のため残す。ただし、artifact-contracts.yaml が binding された場合は
**DSL の値はデフォルト値程度の意味**しか持たず、artifact-contracts.yaml の値で上書きされる。

```yaml
# agent-contracts DSL（汎用。path_patterns はデフォルト値）
artifacts:
  openapi-spec:
    type: api-contract
    authority: canonical
    path_patterns: ["specs/**/*.yaml"]     # デフォルト値。binding で上書き可
    required_validations: [openapi-lint]
    guardrails: [no-manual-edit]
```

原則としては、**artifact-contracts.yaml で全て定義して上書きすることが望ましい**。
agent-contracts DSL 中の具象値（path_patterns 等）はデフォルト値に過ぎない。

### 3.2 agent-contracts 中の artifact は既に抽象化されている

agent-contracts DSL の artifact 定義は **抽象 ID** である。agent / task / guardrail は
この ID を参照する:

- `agent.can_write_artifacts: [openapi-spec]` — agent が書ける artifact
- `task.input_artifacts: [openapi-spec]` — task が必要とする artifact
- `guardrail.scope.artifacts: [openapi-spec]` — guardrail が適用される artifact

これらの ID 参照は変更不要。**実体（path_patterns 等の具象データ）は config レベルで
artifact-contracts.yaml と binding により解決する**。

### 3.3 variant と artifact の関係

variant agent には `can_read/write_artifacts` で **具体的な artifact ID を直接指定**する。
LLM は `purpose` + `can_read/write_artifacts` を見て委譲先を判断する。

```yaml
agents:
  implementer.api_contract:
    $clone:
      from: implementer
      merge:
        purpose: "Implementer for API contract changes"
        can_write_artifacts:
          $replace: [openapi-spec]          # ← LLM がこれを見て判断
        can_read_artifacts: [api-handler]
```

---

## 4. 提案② — artifact binding（config で artifact-contracts.yaml を上書き注入）

### 4.1 binding の流れ

```text
1. artifact-contracts.yaml を読み込む（プロジェクト固有の artifact 一覧）
2. artifact-contracts の ID と agent-contracts 中の artifact ID をマッピング
   - ID が一致するもの → そのまま上書き
   - ID が一致しないもの → mappings で明示的に対応付け
3. agent-contracts 中の artifact 定義は、既存の artifacts: をそのまま利用
   - ただし binding により artifact-contracts.yaml の値で上書きされる
   - agent-contracts 中の値はデフォルト値程度の意味
4. binding 後、新しい resolved layer を構築（Bound DSL）
```

### 4.2 config の設定

config に `artifact_binding` フィールドを追加する。

#### 簡易形式（ID が全一致する場合）

```yaml
# agent-contracts.config.yaml
dsl: ./agent-contracts.yaml
artifact_binding: ./artifact-contracts.yaml
bindings: [./binding.yaml]
paths:
  api_dir: specs/openapi
```

#### 明示的マッピング形式（ID が一致しない場合）

```yaml
# agent-contracts.config.yaml
dsl: ./agent-contracts.yaml
artifact_binding:
  source: ./artifact-contracts.yaml
  mappings:
    # agent-contracts の artifact ID → artifact-contracts の artifact ID
    openapi-spec: billing_api_contract
    api-handler: billing_api_handler
    api-test: billing_api_test
bindings: [./binding.yaml]
paths:
  api_dir: specs/openapi
```

#### config スキーマ

```ts
// AgentContractsConfigSchema に追加
AgentContractsConfig += {
  artifact_binding?: string | {            // 簡易形式: パス文字列
    source: string;                        // 明示的形式: artifact-contracts.yaml へのパス
    mappings?: Record<string, string>;     // agent-contracts ID → artifact-contracts ID
  };
}
```

`teams` 単位でも指定可能:

```yaml
teams:
  billing:
    dsl: ./agent-contracts.yaml
    artifact_binding:
      source: ./billing-artifact-contracts.yaml
      mappings:
        openapi-spec: billing_api_contract
```

### 4.3 上書きセマンティクス

artifact-contracts.yaml の artifact 定義は、agent-contracts DSL の artifact 定義を
**フィールド単位で上書き**する。DSL にしかないフィールドは維持、artifact-contracts にしか
ないフィールドは追加。

```text
Bound artifact = deepMerge(DSL artifact, artifact-contracts artifact)
```

具体例:

```yaml
# agent-contracts DSL の定義（デフォルト値）
openapi-spec:
  type: api-contract
  authority: canonical
  path_patterns: ["specs/**/*.yaml"]    # デフォルト
  required_validations: [openapi-lint]

# artifact-contracts.yaml の定義（プロジェクト固有）
billing_api_contract:                    # mappings: openapi-spec → billing_api_contract
  type: api-contract
  authority: canonical
  path_patterns: ["{api_dir}/openapi.yaml"]   # 上書き
  x-domain: billing                            # 追加

# Bound 後の結果
openapi-spec:
  type: api-contract
  authority: canonical
  path_patterns: ["specs/openapi/openapi.yaml"]   # 上書き + {var} 展開
  x-domain: billing                                # artifact-contracts から追加
  required_validations: [openapi-lint]             # DSL から維持
```

### 4.4 artifact-contracts.yaml 不在時の挙動

`artifact_binding` が config に未指定の場合:
- **従来動作のまま**。DSL の `path_patterns` がそのまま使われる。
- 既存プロジェクトは一切影響を受けない。

### 4.5 接続規約

```text
DSL(デフォルト)              config(注入)                     artifact-contracts.yaml(具象)
artifacts.openapi-spec       ── artifact_binding ──▶  billing_api_contract (via mappings)
  path_patterns: [specs/**]                            path_patterns: [{api_dir}/openapi.yaml]
  type: api-contract                                   x-domain: billing
                             ── paths.api_dir ───────▶  {api_dir} → specs/openapi
                                                         ↓
                                                    上書きマージ → Bound artifact
```

---

## 5. 提案③ — 2 層の resolve フロー

### 5.1 既存 resolve（DSL 単体）— 変更なし

```text
loadDsl → resolveExtendsChain → resolveClone → resolveToolExtends → substituteVars → expandDefaults
→ Resolved DSL
```

`resolveClone`（新規）を追加するが、`$clone` がなければ no-op。
出力は **agent-contracts DSL 単体の完全定義**。プロジェクト固有の具象データは含まない。

### 5.2 Bound resolve（config レベルの全マージ・新規）

Bound resolve は artifact-contracts だけでなく、**config が注入する全プロジェクト固有情報を
統合**した結果を生成する。artifact-contracts が最大の新規追加要素だが、既存の guardrail binding /
paths / policy 解決も同じ層に属する。

```text
Resolved DSL
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
navigation-index / SDK adapter / guardrail scope 解決
```

### 5.3 2 層の比較

| | 既存 resolve（DSL 単体） | Bound resolve（config 全マージ） |
|---|---|---|
| 入力 | agent-contracts.yaml (+ extends chain) | Resolved DSL + config 全体（artifact-contracts, bindings, paths, policy, ...） |
| 出力 | Resolved DSL | Bound DSL |
| artifacts | 抽象定義（path_patterns はデフォルト値） | 抽象 + 具象（artifact-contracts で上書き + `{var}` 展開済み） |
| guardrails | 抽象宣言のみ | guardrail_impl と合成済み（`_guardrailRules`） |
| artifact-contracts | 不要 | 必要（config.artifact_binding で指定） |
| 用途 | DSL 構造検証、lint、`$clone` 展開 | SDK adapter、navigation-index、guardrail scope |
| 後方互換 | 完全互換 | config 注入が未指定時は Resolved DSL = Bound DSL |

### 5.4 `resolveArtifactBinding` の実装

```ts
resolveArtifactBinding(resolvedDsl, registry, mappings?, paths?): {
  boundDsl: ResolvedDsl;
  diagnostics: Diagnostic[];
}

for (dslArtifactId, dslArtifact) of resolvedDsl.artifacts:
  registryId = mappings?.[dslArtifactId] ?? dslArtifactId

  concrete = registry.artifacts[registryId]
  if (!concrete):
    diagnostics.push({ severity: "warning", message: `No binding for "${dslArtifactId}"` })
    continue

  boundDsl.artifacts[dslArtifactId] = deepMerge(dslArtifact, concrete)

for (registryId) of registry.artifacts:
  if registryId not in reverseMapping:
    diagnostics.push({ severity: "warning", message: `Orphan artifact "${registryId}"` })

substituteVarsInPaths(boundDsl.artifacts, paths)
```

### 5.5 navigation-index への接続

`buildNavigationIndex` は今 `dsl.artifacts.path_patterns` を直接読んでいるが、
**Bound DSL の artifacts を読む**よう差し替える。Bound DSL では path_patterns が
artifact-contracts.yaml から上書きされ、`{var}` も展開済みになっている。

`artifact_binding` 不在時は Resolved DSL = Bound DSL なので、従来の DSL path_patterns が
そのまま使われる。

---

## 6. 提案④ — 検証（既存 binding lint と同型）

| ルール | 内容 | 重大度 |
|--------|------|--------|
| unbound-artifact | DSL の artifact に対応する artifact-contracts エントリがない | warning |
| orphan-binding | artifact-contracts の artifact が DSL に対応 ID を持たない | warning |
| referenced-undefined | agent/tool/guardrail が未定義の artifact ID を参照 | error |
| path-overlap | 複数 artifact の path_patterns が重複（既存 `detectOverlaps` 流用） | warning |
| type-mismatch | DSL と artifact-contracts で同一 ID の type/authority が矛盾 | warning |

---

## 7. 副次効果 — guardrail scope の重複解消

現状 `guardrail_impl[].checks[].matcher.file_glob` は具象パスを binding に直書きしている
（`resolve-checks.ts` は `scope.artifacts` を glob へ展開しない）。

artifact が Bound resolve で具象 path_patterns を持った後は、**`scope.artifacts: [openapi-spec]`
を持つ guardrail の file_glob を、bound artifact の path_patterns から自動導出**できる。これにより
guardrail binding でのパス重複記述を削減できる（オプション拡張）。

---

## 8. 全体像 — 同一パターンへの統一

| 関心事 | 抽象（DSL・デフォルト） | 具象（binding / config） | Resolver |
|--------|----------------------|--------------------------|----------|
| guardrail | `guardrails[id].scope` + policy | `SoftwareBinding.guardrail_impl[id].checks` | `resolveChecks`（既存） |
| **artifact** | **`artifacts[id]`（type/authority/path_patterns — デフォルト値）** | **artifact-contracts.yaml（`artifact_binding` で指定）** | **`resolveArtifactBinding`（新規）** |
| **agent variant** | **`$clone`（resolve 時展開）** | **（不要 — resolve 時に完全定義に展開済み）** | **`resolveClone`（新規）** |
| toolchain | `tools[id].cli_contract`（抽象） | cli-contracts `execution_profiles.command_sets` | cli-contracts |
| model/env | task `model_class`（抽象） | `agent-runtime.config` `model_mapping` | runtime |
| output path | binding `outputs[].target {var}` | `config.paths` | `resolveBindingTargetPath`（既存） |

artifact 行だけが「具象が DSL 側」に固定されていた。artifact-contracts.yaml による上書きを
config 注入（`artifact_binding`）で行うと、全行が同じ「config が選択・注入、本体は別ファイル、
DSL はデフォルト値」に揃う。**Bound DSL はこれら全 config 注入の統合結果**であり、
artifact binding はその中で最大の新規追加要素。

---

## 9. 移行（段階的・非破壊）

| 段階 | 内容 | 影響 |
|------|------|------|
| 1 | `AgentContractsConfig` に `artifact_binding?`（team 単位含む）を追加 | config のみ。後方互換（無ければ従来動作） |
| 2 | `resolveArtifactBinding(dsl, registry, mappings, paths)` 実装 | 新規。未指定時は no-op |
| 3 | `buildNavigationIndex` を Bound DSL の artifacts から読むよう差し替え。`artifact_binding` 不在時は従来の DSL path_patterns に fallback | 既存 DSL を壊さない |
| 4 | 段階的に artifact-contracts.yaml に具象を集約し、DSL の path_patterns をデフォルト値化 | SSoT 一本化 |

---

## 10. variant 生成モデル（`$clone` + LLM 委譲）

> v1 の §10「エージェント粒度と呼び出し時結線」を全面改訂。fanout モデルを廃止し、
> resolve 時の `$clone` による variant 生成 + LLM description ベース委譲に移行。

### 10.1 設計原則 — fanout ではなく variant 並列定義

| NG（廃止） | OK（採用） |
|-----------|-----------|
| workflow に fanout を書く | `$clone` で agent/task variant を並列定義として生成 |
| runtime で fanout 制御する | LLM runtime には候補 agents を全部登録 |
| 呼び出し元で agent variant を分岐する | LLM が `purpose` + `can_read/write_artifacts` を見て委譲先を選ぶ |

### 10.2 `$clone` による variant 生成

エージェント契約は **行動契約が安定する粒度**で base を定義する。variant は
`$clone`（既存オブジェクトのコピー + 差分マージ）で生成する。

```yaml
agents:
  implementer:
    role_name: Implementer
    purpose: "General-purpose implementer for code changes"
    mode: read-write
    can_execute_tools: [Read, Edit, Write]
    can_write_artifacts: [openapi-spec, api-handler]

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
            - "Preserve backward compatibility"
            - "Validate schema changes"
```

resolve 後は **2 つの独立した agent 定義**が agents map に存在する。runtime は通常どおり
`buildCandidateAgents()` で全候補を LLM に登録し、LLM が `purpose` + `can_write_artifacts`
を見て委譲先を選ぶ。

詳細は `agent-contracts/docs/spec/instantiate-variant-slots-spec.md` §2 を参照。

### 10.3 guardrail との一貫性

「割当ドメイン外を編集しない」型の guardrail も同型で解ける:

- DSL: `scope.artifacts` は artifact ID（抽象）を指す
- Bound resolve: artifact の path_patterns が artifact-contracts.yaml で具象化される
- 実行時: guardrail scope が具象パスに展開される

variant ごとに異なる guardrail scope が必要なら、variant の `$clone.merge` で
`guardrails` を追加する。

---

## 11. resolve の二相と直列化境界

### 11.1 二相モデル

```text
Phase 1 「DSL resolve + Bound resolve」  ── 静的・決定的・ハッシュ可能
  入力 : agent-contracts.yaml + config 全体
  処理 :
    1. DSL resolve — extends / $clone / toolExtends / vars → Resolved DSL
    2. Bound resolve — config レベルの全マージ:
       ├─ artifact_binding (artifact-contracts.yaml で artifacts 上書き)
       ├─ bindings (SoftwareBinding — guardrail_impl 合成)
       ├─ paths ({var} 展開)
       ├─ active_guardrail_policy
       └─ (将来: model_mapping 等)
       → Bound DSL
  出力 : Bound DSL（= Resolved DSL + config 全プロジェクト固有情報の統合）
         + 安定ハッシュ resolved_contract_hash
  性質 : 純合成（参照透過）。同じ入力 → 同じ直列化 → 同じハッシュ

Phase 2 「dispatch（実行時）」 ── LLM による委譲先選択
  入力 : Bound DSL + task context（自然言語 request）
  処理 : LLM が candidate agents の purpose / can_read_write_artifacts を見て委譲先を選択
  出力 : 選択された agent による task 実行結果
  性質 : LLM 依存。再現不能。結果は Envelope に記録
```

### 11.2 静的 / 動的の境界

| 要素 | 静的（Phase 1・Bound DSL） | 動的（Phase 2・実行時） |
|------|--------------------------|----------------------|
| DSL resolve（extends / vars / $clone） | Yes | |
| artifact binding（artifact-contracts.yaml で上書き） | Yes | |
| guardrail binding（guardrail_impl 合成） | Yes | |
| policy 選択（active_guardrail_policy） | Yes | |
| `{var}`（config.paths）展開 | Yes | |
| glob → **実際にマッチするファイル集合** | | Yes（FS 状態依存） |
| **LLM による variant 選択**（どの agent に委譲するか） | | Yes（purpose + artifacts ベース） |
| context-map / read-edit-validate ターゲット | | Yes |

### 11.3 設計規範

- **Phase 1 は純粋マージ**（順序確定・参照透過）。`(DSL, config) → Bound DSL` を
  決定的にする。drift 検出・キャッシュ・再現性・navigation-index 安定化の基盤。
  config が注入する全要素（artifact binding, guardrail binding, paths, policy）が
  この Phase に含まれる。
- **Phase 2 は LLM の委譲判断のみ**。全 binding は Phase 1 で完了済み。
- `resolved_contract_hash` は Phase 1（Bound DSL）に対して計算。

### 11.4 AaaC 対応

- Bound DSL = **derived view**（手書きせず計算する派生物）。
  `Contract Version` は DSL Owner、`resolved_contract_hash` は Registry Index。
- LLM の委譲判断 = **run fact** → Envelope / Observer（Lineage）。
  Bound DSL には書かない（Rule 1: 実行事実を契約に混ぜない）。

---

## 12. 残課題

- `config.artifact_binding` のロード経路（artifact-contracts.yaml の `$ref` 解決と `paths`
  による `{var}` 展開を、config loader が行うか resolveArtifactBinding が行うか）。
- `tool.artifact_bindings`（既存・DSL 内の静的参照）と config `artifact_binding`（新規・
  artifact-contracts.yaml 上書き）の関係の明確化:
  - tool の `artifact_bindings`: DSL 内で tool の cli-contract slot を artifact ID に静的参照
  - config の `artifact_binding`: artifact-contracts.yaml を読み込んで DSL artifacts を上書き
- guardrail file_glob 自動導出（§7）を初期に含めるか後続にするか。
