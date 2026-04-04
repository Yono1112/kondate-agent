# 献立エージェント Phase 1 設計書

## 1. 概要

一人暮らしの自炊を支援するAIエージェントのPhase 1（最小プロトタイプ）。
毎日チャットで会話しながら、献立提案・食材在庫管理・食事記録を行う。

### スコープ

- 献立提案（在庫・履歴・ユーザー設定を考慮し、複数候補を提示）
- 食材在庫管理（追加・更新・削除・消費期限チェック）
- 食事記録（記録・履歴検索）
- ユーザー設定管理（優先度・家族構成・好み・アレルギー）

### スコープ外（後続フェーズ）

- LINE連携（Phase 2）
- YouTuberレシピ取り込み・RAG検索（Phase 3）
- 自律実行・cron・チラシ情報（Phase 4）
- スーパーの特売情報検索（Phase 4）

---

## 2. アーキテクチャ

### エージェント構成

シンプルエージェント1つで全機能を担当する。

- **エージェント名:** kondate-agent（自炊アシスタント）
- **モデル:** `google/gemini-3-flash-preview`
- **会話履歴:** Mastra Memory で保持（日々の会話がつながる）
- **フロントエンド:** Mastra Studio（localhost:4111）で検証

### システム構成

```
Mastra Studio (localhost:4111)
        │
   Mastra Agent
  「自炊アシスタント」
        │
   ┌────┼────┐
   ↓    ↓    ↓
 ツール群  Mastra Memory
   │
   ↓
 LibSQL (ローカルファイルDB)
```

---

## 3. データ設計

### ストレージ

LibSQL（ローカルファイルDB）を使用。外部依存なしで素早く検証可能。
Phase 3でRAG（ベクトル検索）が必要になった段階でSupabase/pgvectorへの移行を検討。

### テーブル設計

#### inventory（食材在庫）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| name | TEXT | 食材名 |
| quantity | REAL | 数量 |
| unit | TEXT | 単位（個, g, ml, 本, パック等） |
| expiry_date | TEXT | 消費期限（YYYY-MM-DD） |
| purchased_at | TEXT | 購入日（YYYY-MM-DD） |
| created_at | TEXT | 作成日時 |
| updated_at | TEXT | 更新日時 |

#### meals（食事記録）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| date | TEXT | 日付（YYYY-MM-DD） |
| meal_type | TEXT | 食事タイプ（breakfast, lunch, dinner, snack） |
| dish_name | TEXT | 料理名 |
| ingredients | TEXT | 使った食材（JSON配列） |
| notes | TEXT | メモ（任意） |
| created_at | TEXT | 作成日時 |

#### preferences（ユーザー設定）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| key | TEXT | 設定キー（UNIQUE） |
| value | TEXT | 設定値（JSON） |
| updated_at | TEXT | 更新日時 |

**設定キーの例:**

| key | value例 | 説明 |
|-----|---------|------|
| `priority` | `{"nutrition": 3, "ease": 5, "cost": 4, "variety": 3}` | 献立の優先度（1-5） |
| `household` | `{"adults": 1, "children": 0}` | 家族構成 |
| `allergies` | `["えび", "かに"]` | アレルギー |
| `dislikes` | `["パクチー", "セロリ"]` | 苦手な食材 |
| `budget_monthly` | `30000` | 月間食費予算（円） |

---

## 4. ツール設計

### 4.1 manage_inventory

食材在庫の追加・更新・削除・一覧取得。

- **入力:** action (`add` | `update` | `remove` | `list`), name, quantity, unit, expiry_date
- **出力:** 操作結果 + 現在の在庫リスト
- `add`: 新しい食材を追加
- `update`: 既存食材の数量・消費期限を更新
- `remove`: 食材を削除（使い切った時）
- `list`: 全在庫を返す

### 4.2 check_expiry

消費期限が近い食材を警告。

- **入力:** threshold_days（デフォルト3日）
- **出力:** 期限が近い食材のリスト（期限日付順）

### 4.3 record_meal

食事を記録。記録時に使用した食材の在庫を自動で減らす。

- **入力:** date, meal_type, dish_name, ingredients, notes
- **出力:** 記録結果

### 4.4 search_meals

食事履歴を検索。

- **入力:** start_date, end_date, keyword（任意）
- **出力:** 条件に合う食事記録のリスト

### 4.5 manage_preferences

ユーザー設定の取得・更新。

- **入力:** action (`get` | `set`), key, value
- **出力:** 現在の設定値
- `get`: keyを指定して取得（keyなしで全設定を返す）
- `set`: key-valueを保存・更新

### 4.6 suggest_menu

在庫・履歴・設定を総合して献立候補を生成するためのコンテキスト情報を取得。

- **入力:** meal_type（breakfast | lunch | dinner）, additional_request（任意、例:「今日は手軽なのがいい」）
- **出力:**
  - 現在の在庫リスト
  - 直近7日間の食事履歴
  - ユーザー設定（優先度・好み・アレルギー・家族構成）
  - 消費期限が近い食材

エージェントはこの情報をもとに**3つ程度の献立候補**を考えて提示する。各候補には以下を含む:
- 料理名
- 必要食材
- 在庫でまかなえる割合
- 買い足しが必要な食材リスト

---

## 5. エージェントのプロンプト設計

### 基本指示

- 自炊アシスタントとして、献立提案・食材管理・食事記録をサポート
- 日本語で応答
- ユーザーの設定（優先度・家族構成・好み・アレルギー）を`manage_preferences`で取得して考慮
- 献立提案時は必ず`suggest_menu`で在庫・履歴・設定を確認してから提案

### 献立提案の方針

- 優先度の重み付け（栄養バランス/手軽さ/コスト/バリエーション）はユーザー設定に従う
- 直近の食事と被らないようにする
- 在庫の食材を優先的に使う（特に消費期限が近いもの）
- 足りない食材は買い物リストとして提示
- 3つ程度の候補を提示し、ユーザーに選んでもらう

### 会話スタイル

- 簡潔でフレンドリー
- 「今日は何が食べたい？」のように自然に聞く
- 設定変更は会話の中で自然に受け付ける（「今日は手軽なのがいい」→ 一時的に手軽さ優先）

### 設定の一時的な上書き

ユーザーが会話中に「今日は安く済ませたい」のように言った場合、`manage_preferences`は更新せず、その会話内でのみコスト優先で提案する。「いつも安く済ませたい」のように恒久的な変更を希望した場合のみ設定を更新する。

---

## 6. 今後のフェーズとの関係

| フェーズ | 内容 | Phase 1からの拡張ポイント |
|---------|------|-------------------------|
| Phase 2 | LINE連携 | Mastra HTTPサーバー + LINE Webhook。エージェントはそのまま流用 |
| Phase 3 | YouTubeレシピ取り込み | recipesテーブル追加、search_recipes_sql/ragツール追加。DB移行（pgvector） |
| Phase 4 | 自律実行・チラシ情報 | cron Workflow追加、search_flyersツール追加、send_lineツール追加 |

---

## 7. 既存コードへの影響

- `src/mastra/agents/weather-agent.ts` → 削除し `kondate-agent.ts` に置き換え
- `src/mastra/tools/weather-tool.ts` → 削除し各ツールファイルに置き換え
- `src/mastra/workflows/weather-workflow.ts` → 削除（Phase 1では不要）
- `src/mastra/scorers/weather-scorer.ts` → 削除（Phase 1では不要）
- `src/mastra/index.ts` → 新しいエージェント・ツールを登録
