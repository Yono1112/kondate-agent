# kondate-agent リファクタリング計画

## Context

kondate-agent は Mastra ベースの献立管理エージェント。ツール数が9個＋テスト9個まで成長したが、共通ヘルパーが存在せず、以下の負債が蓄積している:

- **DBレスポンスへの `as string` / `as number` キャストが31箇所**に散在し、ランタイム型安全性が担保されていない（例: `new Date(row.expiry_date as string)` は null のとき Invalid Date 化する）
- **期限残日数計算**が `check-expiry.ts` と `suggest-menu.ts` で重複
- **LINE APIクライアント初期化 + 環境変数バリデーション**が `send-line.ts` / `send-line-buttons.ts` / `line-webhook.ts` で重複
- **preferences 行→オブジェクト変換**が `manage-preferences.ts` と `suggest-menu.ts` で重複

ユーザー指定のゴール: **重複コードの共通化** と **型安全性の向上**。

目的: `src/mastra/utils/` を新設し、Zod による DB 行バリデーション・日付計算・LINE クライアント生成の共通ヘルパーに集約して、重複を削除しつつランタイム型安全性を強化する。

## 方針

- 新規ディレクトリ `src/mastra/utils/` を作成し、目的別に4ファイルに分割
- DB 行のキャストは **Zod schema で parse** に置換（ランタイム検証を得る）
- 既存テスト（`src/mastra/tools/__tests__/`）は動作不変で通過することをもって回帰検証とする
- ツール本体の I/O（入力スキーマ・出力形状）は変更しない → 呼び出し側（agent/workflows）への影響ゼロ

## 変更対象ファイル

### 新規作成

| ファイル | 役割 |
|---|---|
| `src/mastra/utils/dbSchemas.ts` | Zod schema + row 型定義（InventoryRow / MealRow / PreferenceRow）と `parseInventoryRow` 等のヘルパー |
| `src/mastra/utils/dateUtils.ts` | `calculateDaysRemaining(expiryDateStr: string): number` |
| `src/mastra/utils/lineClient.ts` | `createLineMessagingClient()` と `resolveLineCredentials()`（env 読込 + バリデーション統合） |
| `src/mastra/utils/preferences.ts` | `rowsToPreferenceMap(rows): Record<string, string>` |

### 修正

| ファイル | 修正内容 |
|---|---|
| `src/mastra/tools/manage-inventory.ts` | 行マッピング（97-105 他）を `parseInventoryRow` に差し替え |
| `src/mastra/tools/check-expiry.ts` | 日付計算（38-45）を `calculateDaysRemaining` に差し替え、行マップを Zod 化 |
| `src/mastra/tools/search-meals.ts` | 行マッピング（59-66）を `parseMealRow` に差し替え |
| `src/mastra/tools/record-meal.ts` | DB 行読み取り箇所を Zod 化 |
| `src/mastra/tools/suggest-menu.ts` | 在庫/食事/設定の3種マッピング（51-101）を utils に集約、日付計算も差し替え |
| `src/mastra/tools/manage-preferences.ts` | `rowsToPreferenceMap` に差し替え |
| `src/mastra/tools/parse-receipt.ts` | `existing.rows[0].quantity as number` を Zod で検証 |
| `src/mastra/tools/send-line.ts` | 20-33 を `resolveLineCredentials` + `createLineMessagingClient` に置換 |
| `src/mastra/tools/send-line-buttons.ts` | 48-61 を同様に置換 |
| `src/mastra/webhooks/line-webhook.ts` | 20-25 を同様に置換 |

## 参照する既存コード

- テスト基盤: `src/mastra/tools/__tests__/setup.ts`（DB 初期化/クリーンアップ）— 変更不要
- DB クライアント: `src/mastra/db/client.ts` — 変更不要
- すでに全ツールで `zod` を tool input schema に使用しているため、新規依存は不要

## 非対象（やらないこと）

- ツールの入力/出力スキーマ変更
- `src/mastra/index.ts` のエージェント/ツール登録内容の変更
- テストファイルのロジック変更（型キャスト `(c as any)` 等はテスト内で許容）
- LINE メッセージフォーマット仕様の変更

## 検証

1. **型チェック**: `npx tsc --noEmit` でエラーゼロ
2. **ビルド**: `npm run build` が成功
3. **ユニットテスト**: `src/mastra/tools/__tests__/` 既存テストがすべてパス
   - 特に `manage-inventory.test.ts`, `check-expiry.test.ts`, `suggest-menu.test.ts`, `parse-receipt.test.ts`, `send-line.test.ts`, `line-webhook.test.ts`
4. **手動スモーク**: `npm run dev`（Mastra Studio）で在庫一覧・期限チェック・献立提案ツールを実行し、形状が従来と一致することを確認
5. **回帰観点**: null 許容カラム（`expiry_date`, `purchased_at`, `notes`）が null のケースで Zod が落ちないこと（`.nullable()` を schema に設定）

## リスクと対策

- **リスク**: Zod `parse` が既存 DB データのエッジケース（空文字、型不一致）で throw する可能性
- **対策**: schema は初版で `.nullable()` と `z.coerce` を積極利用し、既存テストデータを通過させる。落ちたら該当カラムの実データを確認し schema を調整
