# 献立エージェント (kondate-agent)

一人暮らしの自炊を支援するAIエージェント。毎日チャットで会話しながら、献立提案・食材在庫管理・食事記録を行います。

[Mastra](https://mastra.ai/) フレームワークで構築。

## 現在の実装状況

### Phase 1: 最小プロトタイプ (完了)

Mastra Studio上で動作する自炊アシスタントエージェント。

- 献立提案（在庫・履歴・ユーザー設定を考慮し、複数候補を提示）
- 食材在庫管理（追加・更新・削除・消費期限チェック）
- 食事記録（記録・履歴検索・在庫自動減算）
- ユーザー設定管理（優先度・家族構成・アレルギー・苦手な食材）

### 今後のフェーズ

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 2 | LINE連携 | 未着手 |
| Phase 3 | YouTuberレシピ取り込み・RAG検索 | 未着手 |
| Phase 4 | 自律実行・cron・チラシ情報 | 未着手 |

## セットアップ

### 前提条件

- Node.js >= 22.13.0
- Google AI Studio の API キー（[取得はこちら](https://aistudio.google.com/apikey)）

### インストール

```bash
npm install
```

### 環境変数

`.env` ファイルをプロジェクトルートに作成:

```
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key
```

### 起動

```bash
npm run dev
```

ブラウザで http://localhost:4111 を開くと Mastra Studio が起動します。「自炊アシスタント」エージェントとチャットできます。

## アーキテクチャ

```
Mastra Studio (localhost:4111)
        │
   Mastra Agent
  「自炊アシスタント」(Gemini 3 Flash)
        │
   ┌────┼────┐
   ↓    ↓    ↓
 ツール群  Mastra Memory（会話履歴）
   │
   ↓
 LibSQL (ローカルファイルDB)
```

## プロジェクト構成

```
src/mastra/
├── index.ts                    # Mastraエントリポイント
├── agents/
│   └── kondate-agent.ts        # 自炊アシスタントエージェント
├── db/
│   ├── client.ts               # LibSQLクライアント
│   ├── schema.ts               # テーブル定義 (inventory, meals, preferences)
│   └── seed.ts                 # 初期データ投入
└── tools/
    ├── manage-inventory.ts     # 食材在庫管理 (追加/更新/削除/一覧)
    ├── check-expiry.ts         # 消費期限チェック
    ├── record-meal.ts          # 食事記録 (在庫自動減算)
    ├── search-meals.ts         # 食事履歴検索
    ├── manage-preferences.ts   # ユーザー設定管理
    └── suggest-menu.ts         # 献立コンテキスト取得
```

## ツール一覧

| ツール | 説明 |
|--------|------|
| `manage-inventory` | 食材在庫の追加・更新・削除・一覧取得 |
| `check-expiry` | 消費期限が近い食材の警告（デフォルト3日以内） |
| `record-meal` | 食事記録。使った食材の在庫を自動で減算 |
| `search-meals` | 期間・キーワードによる食事履歴検索 |
| `manage-preferences` | ユーザー設定の取得・更新（優先度・アレルギー等） |
| `suggest-menu` | 在庫・履歴・設定・期限情報を集約し、エージェントが献立を提案するためのコンテキストを提供 |

## 使い方の例

```
ユーザー: 鶏むね肉500g、消費期限は4/8で在庫に追加して
エージェント: 鶏むね肉500gを在庫に追加しました！

ユーザー: 今日の夕飯を提案して
エージェント: 在庫の鶏むね肉を使った提案です！
  1. 鶏むね肉の照り焼き
  2. 鶏むね肉とブロッコリーの中華炒め
  3. しっとり茹で鶏のねぎ塩だれ

ユーザー: 1番目にする。記録して
エージェント: 鶏むね肉の照り焼きを夕食として記録しました！（在庫も自動更新済み）
```

## コマンド

```bash
npm run dev     # Mastra Studio起動 (localhost:4111)
npm run build   # プロダクションビルド
npm run start   # ビルド済みサーバー起動
```

## 技術スタック

- [Mastra](https://mastra.ai/) (`@mastra/core` v1.21+) — AIエージェントフレームワーク
- [Gemini 3 Flash](https://ai.google.dev/) — LLMモデル
- [LibSQL](https://github.com/tursodatabase/libsql) — ローカルファイルDB
- [Zod](https://zod.dev/) v4 — スキーマバリデーション
- TypeScript (ES2022)
