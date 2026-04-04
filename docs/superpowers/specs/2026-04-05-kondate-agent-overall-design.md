# 自炊アシスタントエージェント — 全体設計書

## 1. プロジェクト概要

一人暮らしの自炊を全面サポートするAIエージェント。毎日会話しながら使い、スケジュールに従って自律的にも動作する。

### コンセプト

- 毎日の献立提案（在庫・履歴・好み・優先度を考慮し、複数候補を提示）
- 冷蔵庫の食材から作れるレシピを提案
- 食材の在庫・消費期限管理
- 食べたものの記録・管理
- 好きなYouTuberのレシピを優先的に取り込み・提案
- 近くのスーパーのチラシからお買い得食材を検索
- 足りない食材の買い物リスト + どのスーパーで買うべきかを提示
- 栄養バランスの考慮
- 優先度（栄養/手軽さ/コスト/バリエーション）をいつでも変更可能
- 家族構成・好み・アレルギーの設定対応

### 動作モード

- **対話モード**: ユーザーがチャットで話しかけると応答
- **自律モード**: スケジュールに従いエージェントが自発的に動作し、結果をプッシュ通知
  - 例: 午後6時に献立を提案、朝にチラシのセール情報を検索

---

## 2. 技術スタック

| 要素 | 技術 | 備考 |
|------|------|------|
| フレームワーク | Mastra（TypeScript） | Agent + Workflow の二刀流 |
| LLM | Gemini 3 Flash（`google/gemini-3-flash-preview`） | 無料枠あり、ツール使用・構造化出力対応 |
| DB（Phase 1-2） | LibSQL（ローカルファイルDB） | 外部依存なし、素早く検証可能 |
| DB（Phase 3以降） | Supabase（PostgreSQL + pgvector） | RAGベクトル検索に必要 |
| メッセージング | LINE Messaging API | Webhook受信 + Push送信 |
| デプロイ | Vercel Functions or Cloudflare Workers | |
| レシピ取り込み | yt-dlp + YouTube Data API + LLMバッチ処理 | |
| チラシ取得 | トクバイ・Shufoo!等をWeb検索で参照 | ベストエフォート |

### フレームワーク選定理由: Mastra

1. **スケジュール実行**: Workflowにcronトリガーを設定でき、自律実行が宣言的に書ける
2. **ツール定義の型安全性**: Zodによる入出力スキーマが管理しやすい
3. **API自動生成**: `mastra build` でHTTPサーバーが自動生成され、LINE Webhook受信が容易
4. **RAG組み込み**: ベクトル検索がフレームワークに内蔵、レシピのセマンティック検索に対応
5. **Agent + Workflowの二刀流**: 対話（Agent）とスケジュール実行（Workflow）を使い分けられる

---

## 3. アーキテクチャ

### 最終的なシステム構成

```
LINE ──Webhook──→ Mastra Server ←──Cron Trigger
                      │
                 Mastra Agent
                「自炊アシスタント」
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   DB ツール群    外部検索ツール   LINE Push
        │             │
        ↓             ↓
   PostgreSQL    Web検索 / YouTube
   (Supabase)
```

### エージェント構成

シンプルエージェント1つで全機能を担当する。理由：

- MVPとして最速で検証できる
- 会話の文脈が自然に保てる
- ツール追加で段階的に機能拡張できる

---

## 4. データ設計

### データの分類と記憶方式

| データ種別 | 例 | 記憶方式 | 理由 |
|-----------|-----|---------|------|
| 構造化データ | 食事記録、食材在庫、チラシ情報 | DB + SQLツール | 条件検索が正確・高速 |
| 嗜好・ルール | 「トマト嫌い」「予算3万円」「平日は時短」 | DB → エージェントが参照 | 件数少・毎回参照される |
| YouTuberレシピ（条件検索） | 「鶏むね肉の主菜、30分以内」 | DB + SQLツール | 材料・時間・カテゴリでの絞り込み |
| YouTuberレシピ（曖昧検索） | 「さっぱりしたもの」「映えるやつ」 | RAG（ベクトル検索） | 感覚的なクエリに対応 |
| 一般レシピ・知識 | 「鶏むね肉の下処理方法」 | Web検索ツール | 自前DB化の運用コストが不要 |
| 会話履歴 | 日々の会話 | Mastra Memory | 毎日の会話がつながる |

### DBスキーマ

```sql
-- 食材在庫
inventory (id, name, quantity, unit, expiry_date, purchased_at, created_at, updated_at)

-- 食事記録
meals (id, date, meal_type, dish_name, ingredients, notes, created_at)

-- ユーザー設定（優先度、家族構成、好み、アレルギー等）
preferences (id, key, value, updated_at)

-- レシピ（YouTuberから取り込み）※Phase 3
recipes (id, title, channel, ingredients, cook_time, category, url, summary, vector_embedding)

-- チラシ情報 ※Phase 4
flyers (id, store, item_name, price, original_price, valid_from, valid_until)
```

### ユーザー設定の設計

| key | value例 | 説明 |
|-----|---------|------|
| `priority` | `{"nutrition": 3, "ease": 5, "cost": 4, "variety": 3}` | 献立の優先度（1-5） |
| `household` | `{"adults": 1, "children": 0}` | 家族構成 |
| `allergies` | `["えび", "かに"]` | アレルギー |
| `dislikes` | `["パクチー", "セロリ"]` | 苦手な食材 |
| `budget_monthly` | `30000` | 月間食費予算（円） |
| `favorite_stores` | `[{"name": "ライフ 渋谷店", "address": "..."}]` | よく行くスーパー ※Phase 4 |

**一時的な上書き:** 「今日は安く済ませたい」→ 設定は更新せず会話内でのみ反映。「いつも安く済ませたい」→ 設定を恒久更新。

---

## 5. ツール設計（全フェーズ）

| ツール名 | 機能 | フェーズ |
|---------|------|---------|
| `manage_inventory` | 食材在庫の追加・更新・削除・一覧 | Phase 1 |
| `check_expiry` | 消費期限が近い食材を警告 | Phase 1 |
| `record_meal` | 食事を記録（在庫自動減算あり） | Phase 1 |
| `search_meals` | 食事履歴を検索 | Phase 1 |
| `manage_preferences` | ユーザー設定の取得・更新 | Phase 1 |
| `suggest_menu` | 在庫・履歴・設定を総合して献立コンテキストを取得 | Phase 1 |
| `send_line` | LINEにプッシュメッセージ送信 | Phase 2 |
| `search_recipes_sql` | 条件でレシピ検索（食材・時間・カテゴリ） | Phase 3 |
| `search_recipes_rag` | 曖昧なリクエストでレシピ検索（ベクトル検索） | Phase 3 |
| `search_flyers` | チラシからお買い得情報を検索（Web検索ベース） | Phase 4 |
| `search_web` | 一般的なレシピ・知識の検索 | Phase 4 |
| `manage_stores` | よく行くスーパーの登録・管理 | Phase 4 |

---

## 6. YouTubeレシピ取り込みパイプライン（Phase 3）

### 取り込みフロー

```
YouTuberのチャンネル
    ↓ YouTube Data API / yt-dlp
全動画の字幕 + 概要欄テキスト
    ↓ LLMで構造化（バッチ処理）
recipes テーブル + ベクトル埋め込み
```

### 取り込み方法

1. **字幕抽出 + LLM整形**: yt-dlpで字幕テキスト取得 → LLMに構造化依頼（料理名・材料・手順・時間をJSON化）
2. **概要欄解析**: YouTube Data APIで概要欄取得 → LLMで構造化（字幕より精度が高いことが多い）

### 運用

- 初回: 全動画を一括バッチ処理
- 以降: Mastra cron Workflowで週1回、新着動画を差分取り込み

---

## 7. スケジュール実行 — 自律モード（Phase 4）

Mastra Workflowのcronトリガーで実現。

| 時刻 | 処理内容 |
|------|---------|
| 毎朝 9:00 | チラシサイト（トクバイ等）をWeb検索 → お買い得情報をLINE通知 |
| 毎日 18:00 | 在庫・食事履歴・好み・セール情報を考慮 → 献立をAgent が提案 → LINE通知 |
| 毎週日曜 | 新着YouTube動画をチェック → レシピDB差分取り込み |

---

## 8. スーパー情報の取得（Phase 4）

### 方式

- トクバイ・Shufoo!などのチラシサービスをWeb検索で参照（ベストエフォート）
- ユーザーが事前に「よく行くスーパー」を登録（`manage_stores`ツール）
- 登録済みスーパーを優先的に検索し、特売情報と合わせて「どこで何を買うべきか」を提案

### 買い物リストの出力

献立が決まった後、足りない食材について：
- 登録済みスーパーの特売情報を検索
- 特売品がある店舗を優先して提案
- 店舗ごとに買い物リストをグルーピングして提示

---

## 9. エージェントのプロンプト設計

### 基本指示

- 自炊アシスタントとして、献立提案・食材管理・食事記録をサポート
- 日本語で応答
- ユーザーの設定を毎回確認して考慮

### 献立提案の方針

- 優先度の重み付け（栄養バランス/手軽さ/コスト/バリエーション）はユーザー設定に従う
- 直近の食事と被らないようにする
- 在庫の食材を優先的に使う（特に消費期限が近いもの）
- 足りない食材は買い物リストとして提示
- 3つ程度の候補を提示し、ユーザーに選んでもらう

### 会話スタイル

- 簡潔でフレンドリー
- 設定変更は会話の中で自然に受け付ける

---

## 10. 開発フェーズ

### Phase 1: 最小プロトタイプ

- エージェント定義（Gemini 3 Flash）
- LibSQLテーブル作成（inventory, meals, preferences）
- ツール6つ実装（manage_inventory, check_expiry, record_meal, search_meals, manage_preferences, suggest_menu）
- Mastra Studioでテスト
- **詳細:** `2026-04-05-kondate-agent-phase1-design.md` 参照

### Phase 2: LINE連携

- LINE Messaging API設定（Webhook + Push）
- Mastra HTTPサーバーとの接続
- send_lineツール実装
- 対話モードの完成
- デプロイ（Vercel / Cloudflare）

### Phase 3: レシピ機能

- YouTubeレシピ取り込みパイプライン構築
- DB移行（LibSQL → Supabase/pgvector）
- recipesテーブル + ベクトル埋め込み
- search_recipes_sql / search_recipes_rag ツール実装

### Phase 4: 自律実行 + スーパー情報

- Mastra cron Workflow設定
- チラシ情報のWeb検索ツール実装（トクバイ等）
- よく行くスーパーの登録・管理（manage_stores）
- 献立自動提案 + LINE Push通知
- 買い物リスト + スーパー別グルーピング

### Phase 5: 改善・拡張

- 栄養バランス分析の高度化
- 複数YouTuberチャンネル対応
- レシピのお気に入り・評価機能
- 月間の食費レポート
