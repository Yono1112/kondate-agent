# AGENTS.md

You are a TypeScript developer experienced with the Mastra framework. You build AI agents, tools, workflows, and scorers. You follow strict TypeScript practices and always consult up-to-date Mastra documentation before making changes.

## CRITICAL: Load `mastra` skill

**BEFORE doing ANYTHING with Mastra, load the `mastra` skill FIRST.** Never rely on cached knowledge as Mastra's APIs change frequently between versions. Use the skill to read up-to-date documentation from `node_modules`.

## Project Overview

This is a **Mastra** project written in TypeScript. Mastra is a framework for building AI-powered applications and agents with a modern TypeScript stack. The Node.js runtime is `>=22.13.0`.

## Commands

```bash
npm run test  # Run vitest unit tests (src/mastra/**/__tests__/*.test.ts)
npm run dev   # Start Mastra Studio at localhost:4111 (long-running, use a separate terminal)
npm run build # Build a production-ready server
npm run start # Run the built production server
```

### Verification workflow (MUST follow after code changes)

Whenever you modify tool, agent, webhook, or util code under `src/mastra/`, you **must** run the relevant verification commands before claiming the task is done. Do not skip.

1. **After any code change touching `src/mastra/`**: run `npm run test` and confirm all tests pass
2. **After type-affecting changes** (new exports, signature changes, schema edits): additionally run `npx tsc --noEmit` and confirm zero errors in the files you changed (pre-existing errors in unrelated files may be ignored, but mention them)
3. **After changes to agents/tools/workflows registration**: run `npm run build` to confirm the production build still succeeds
4. **Before committing**: always re-run `npm run test` so the commit is green

If a test fails, diagnose and fix the root cause — do not comment out tests or skip them. If a test genuinely needs updating due to an intentional behavior change, update it and explain why in the commit message.

If tests don't exist for the code you modified, consider whether adding a test is warranted (see `superpowers:test-driven-development`). At minimum, do a manual smoke test via `npm run dev` for LINE-webhook-related changes.

## Project Structure

| Folder                 | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra`           | Entry point for all Mastra-related code and configuration.                                                                               |
| `src/mastra/agents`    | Define and configure your agents - their behavior, goals, and tools.                                                                     |
| `src/mastra/workflows` | Define multi-step workflows that orchestrate agents and tools together.                                                                  |
| `src/mastra/tools`     | Create reusable tools that your agents can call                                                                                          |
| `src/mastra/mcp`       | (Optional) Implement custom MCP servers to share your tools with external agents                                                         |
| `src/mastra/scorers`   | (Optional) Define scorers for evaluating agent performance over time                                                                     |
| `src/mastra/public`    | (Optional) Contents are copied into the `.build/output` directory during the build process, making them available for serving at runtime |

### Top-level files

Top-level files define how your Mastra project is configured, built, and connected to its environment.

| File                  | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/mastra/index.ts` | Central entry point where you configure and initialize Mastra.                                                    |
| `.env.example`        | Template for environment variables - copy and rename to `.env` to add your secret [model provider](/models) keys. |
| `package.json`        | Defines project metadata, dependencies, and available npm scripts.                                                |
| `tsconfig.json`       | Configures TypeScript options such as path aliases, compiler settings, and build output.                          |

## Documentation discipline (MUST keep docs in sync with code)

Code changes without documentation updates create drift. Whenever you ship a change that affects users, configuration, architecture, or decisions, you **must** also update the relevant docs in the same commit (or an immediately following commit).

### When to update `README.md`

Update `README.md` whenever any of the following change:

- Setup steps, required environment variables, or installation commands
- Commands (`npm run test`, `npm run dev` 等) or their behavior
- User-facing features (new agents, new tools, new workflows, new LINE 連携)
- External dependencies (LINE, Mastra のバージョン、DB、API キー 等)
- Project structure (directory layout, top-level files)

If a PR/commit changes any of the above and README is untouched, **that is a bug**. Fix it before declaring the task complete.

### When to write a document under `docs/`

Create or update files under `docs/` for information that does not belong in code comments or README:

| 種類 | 置き場所 | いつ書く |
|---|---|---|
| **設計・アーキテクチャ決定** | `docs/archive/` または `docs/adr/` | 大きな設計判断をした時（なぜその選択をしたかを残す） |
| **実装プラン** | `docs/superpowers/plans/` | 多段階タスクの着手前（superpowers:writing-plans に従う） |
| **仕様書** | `docs/superpowers/specs/` | 新機能の要件を固めた時 |
| **調査ログ・検討ログ** | `docs/research/` | 外部 API 調査、比較検討、第一原理分析などをした時。後のセッションが同じ調査を繰り返さないために残す |
| **トラブルシューティング記録** | `docs/troubleshooting/` | バグ原因と解決策を掘り下げた時。同じ問題に再遭遇した時の時短になる |

**原則**: ユーザーと議論して得た結論（方針決定、第一原理分析、懸念の共有、却下した代替案とその理由）は、会話が終わった瞬間に揮発します。**重要な議論は `docs/` に要約を残してください**。次のセッションで自分が読み直せる形にすることが目的です。

### Commit 粒度のルール

- コード変更 + ドキュメント更新を **同じコミットにまとめる** のが望ましい（レビュー時に対応関係が明確になる）
- ただしドキュメント更新が大きい場合は別コミットでも可。その場合は連続した2コミットで行い、PRをバラさない
- コミットメッセージのタイプは `feat:`, `fix:`, `refactor:` に加えて、純粋なドキュメント更新は `docs:` を使う

### Never do (ドキュメント関連)

- ❌ README に書かれている手順が古くなったまま放置する
- ❌ 設計判断の「なぜ」を口頭/チャット履歴だけに残す（コードや docs/ に痕跡を残さない）
- ❌ 「後でドキュメント書く」と言ってタスクを完了扱いにする
- ❌ 勝手に README をリッチ化する（指示がないのに絵文字・バッジ・長大な説明を追加しない）

## Boundaries

### Always do

- Load the `mastra` skill before any Mastra-related work
- Register new agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use schemas for tool inputs and outputs
- Run `npm run build` to verify changes compile
- **Update `README.md` and `docs/` when changes affect setup, features, architecture, or decisions** (see "Documentation discipline" section above)

### Never do

- Never commit `.env` files or secrets
- Never modify `node_modules` or Mastra's database files directly
- Never hardcode API keys (always use environment variables)
- Never ship code changes that invalidate `README.md` without updating it in the same change set

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Mastra .well-known skills discovery](https://mastra.ai/.well-known/skills/index.json)
