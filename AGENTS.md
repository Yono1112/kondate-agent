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

## Boundaries

### Always do

- Load the `mastra` skill before any Mastra-related work
- Register new agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use schemas for tool inputs and outputs
- Run `npm run build` to verify changes compile

### Never do

- Never commit `.env` files or secrets
- Never modify `node_modules` or Mastra's database files directly
- Never hardcode API keys (always use environment variables)

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Mastra .well-known skills discovery](https://mastra.ai/.well-known/skills/index.json)
