import { ModelRouter } from '@rag-system/model-router';
import type { ToolLoopMessage } from '@rag-system/model-router';
import type { ModelRole, TaskMode, FileChange } from '@rag-system/shared';
import { logger, taskEvents, currentTaskContext } from '@rag-system/shared';
import { WorkingSet } from './working-set.js';
import {
  TOOL_DEFINITIONS,
  dispatchToolCall,
  extractAllowedPaths,
  type WritePolicy,
} from './tool-calling-coder.js';
import type { FixerOutput } from './fixer.js';

/**
 * Fixer reimagined as a tool-calling loop, sibling to ToolCallingCoderAgent.
 *
 * Why this exists: v1.30.1 benchmark on rag-system surfaced that the
 * patch-based Fixer (used in `runValidationLoop`) suffers the SAME failure
 * mode at scale that the patch-based Coder did — search-block hallucination.
 * Fixer was emitting `{search: "import ... from 'jest'", replace: "..."}`
 * for test files where that import doesn't exist anywhere; every search
 * missed; nothing landed; commit_skipped. Migrating Fixer to tool-calling
 * uses the same coordinate-based primitives as Coder and inherits the same
 * scope discipline.
 *
 * Differences from Coder:
 * - Input is a list of validation issues (typecheck/test failures), not a
 *   step description.
 * - Allowed write set is derived from BOTH the issues' file references AND
 *   the files the Coder already produced — a Fixer should be able to edit
 *   anything Coder touched, plus anything an error message points at.
 * - System prompt is fix-shaped: minimal targeted edits, restore imports
 *   instead of deleting the code that uses them, address only the listed
 *   issues.
 */

const MAX_TOOL_CALLS = 50;

const FIXER_SYSTEM_PROMPT = `You are a Code Fixer working through tools.
Given a list of validation issues (typecheck or test failures) and the current set of files, make MINIMAL targeted edits to fix each issue.

YOU CANNOT WRITE A REPLY — only tool calls cause changes:
- read_file(path) — see the actual current bytes of a file (mandatory before editing)
- replace_in_file(path, start_line, end_line, new_text) — edit by line range
- create_file(path, content) — create a new file (rare for Fixer; usually unnecessary)
- delete_file(path) — remove a file
- done() — finalize when all issues are addressed

Workflow:
1. Issues usually reference a file and line number ("src/foo.ts:42: TS2304: Cannot find name X"). Read that file with read_file before editing.
2. Identify the SMALLEST possible fix. "Cannot find name X" → restore the missing import; do NOT delete the code that uses X. "Type Y is not assignable to Z" → fix the offending expression, not the whole function.
3. Apply via replace_in_file. Address one issue at a time.
4. Once every issue is addressed, call done().

Rules:
- ADDRESS ONLY THE LISTED ISSUES. Do not rewrite working code, refactor, or "improve" things the issues don't mention.
- TypeScript common patterns:
  - "Cannot find name 'X'" → restore the import. \`import { X } from './path.js';\`
  - "TS2362/TS2363 left-hand side of arithmetic must be number" on Date subtraction → use .getTime(). \`date1.getTime() - date2.getTime()\`.
  - "Parameter 'x' implicitly has an 'any' type" → add an explicit type annotation.
  - "Cannot find name 'jest'" or "as jest.Mock" → use vitest. \`as ReturnType<typeof vi.fn>\`. \`import { vi } from 'vitest';\`
- Match Project Conventions: test framework, .js suffix in imports for NodeNext, strict mode.

SCOPE DISCIPLINE:
- Write only to paths the issues reference, or paths the Coder produced (the user message lists "Allowed write targets" explicitly).
- Don't touch package.json, package-lock.json, tsconfig.json, vitest/jest config, .env, .gitignore, lockfiles. The dispatcher will reject such writes.
- read_file is unrestricted.
- If a write is rejected, focus on a different in-scope file. Do not bail by calling done() with no changes unless the issues genuinely don't need any source edits.

Output format: tool calls only. When all listed issues are addressed, call done().`;

const ALWAYS_FORBIDDEN_PATTERNS_LOCAL: RegExp[] = [
  /(?:^|\/)package\.json$/,
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)tsconfig.*\.json$/,
  /(?:^|\/)vitest\.config\.(?:ts|js|mjs|cjs)$/,
  /(?:^|\/)jest\.config\.(?:ts|js|mjs|cjs)$/,
  /(?:^|\/)\.env(?:\..+)?$/,
  /(?:^|\/)turbo\.json$/,
  /(?:^|\/)\.gitignore$/,
];

/**
 * Build the Fixer's allowed-write set: union of paths Coder produced AND
 * paths mentioned in any issue (typecheck errors quote `file.ts:42:`,
 * test failures quote test paths). Either source can legitimately need an
 * edit to fix the validation problem.
 */
export function buildFixerAllowedSet(currentFiles: FileChange[], issues: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of currentFiles) out.add(f.path);
  for (const issue of issues) {
    for (const p of extractAllowedPaths(issue)) out.add(p);
  }
  return out;
}

export class ToolCallingFixerAgent {
  name = 'Fixer(tool-calling)';
  role: ModelRole = 'fixer';
  private router: ModelRouter;

  constructor(router: ModelRouter) {
    this.router = router;
  }

  async execute(
    issues: string[],
    currentFiles: FileChange[],
    context: string,
    taskMode: TaskMode,
    projectRoot: string,
  ): Promise<FixerOutput> {
    const ws = new WorkingSet(projectRoot);

    const allowed = buildFixerAllowedSet(currentFiles, issues);
    const policy: WritePolicy = {
      allowed,
      forbiddenPatterns: ALWAYS_FORBIDDEN_PATTERNS_LOCAL,
    };

    const allowedLine =
      allowed.size > 0
        ? `Allowed write targets (only these): ${[...allowed].join(', ')}`
        : `Allowed write targets: any non-protected file (no specific paths derivable from issues)`;

    const issuesBlock = issues.map((iss, i) => `[issue ${i + 1}] ${iss}`).join('\n\n');
    const filesSummary = currentFiles
      .map(f => {
        if (f.action === 'create') return `- ${f.path} (created by Coder, on disk)`;
        if (f.action === 'modify') return `- ${f.path} (modified by Coder, on disk)`;
        return `- ${f.path} (deleted by Coder)`;
      })
      .join('\n');

    const messages: ToolLoopMessage[] = [
      { role: 'system', content: FIXER_SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Validation issues to fix:\n${issuesBlock}\n\n` +
          `Files the Coder already produced (current state on disk):\n${filesSummary || '(none)'}\n\n` +
          `${allowedLine}\n\n` +
          `Project context:\n${context}\n\n` +
          `Read each referenced file before editing. Make the minimal edit that addresses each issue. Call done() when every listed issue is fixed.`,
      },
    ];

    const ctx = currentTaskContext();
    let toolCallsExecuted = 0;
    let doneCalled = false;

    for (let round = 0; round < MAX_TOOL_CALLS && !doneCalled; round++) {
      const response = await this.router.routeWithTools(this.role, messages, TOOL_DEFINITIONS, taskMode);
      const calls = response.toolCalls ?? [];

      if (calls.length === 0) {
        if (round === 0) {
          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content:
              'You did not call any tool. Address each listed issue by reading the referenced file and applying replace_in_file. Or call done() if no source edits can fix these issues.',
          });
          continue;
        }
        break;
      }

      messages.push({ role: 'assistant', content: response.content, tool_calls: calls });

      for (const call of calls) {
        const result = dispatchToolCall(call, ws, policy);
        toolCallsExecuted++;
        messages.push({ role: 'tool', content: result.text, tool_name: call.function.name });

        if (ctx) {
          taskEvents.emitEvent({
            taskId: ctx.taskId,
            type: 'agent_stream',
            data: {
              agent: this.name,
              role: this.role,
              chunk: `[${call.function.name}] ${result.text.slice(0, 80)}`,
              totalLen: toolCallsExecuted,
              ...(ctx.stepId ? { stepId: ctx.stepId } : {}),
            },
          });
        }

        if (result.done) {
          doneCalled = true;
          break;
        }
      }
    }

    if (toolCallsExecuted >= MAX_TOOL_CALLS && !doneCalled) {
      logger.warn(
        { agent: this.name, toolCalls: toolCallsExecuted },
        'Tool-calling Fixer hit MAX_TOOL_CALLS limit without calling done()',
      );
    }

    const files: FileChange[] = ws.toFileChanges();
    if (files.length === 0) {
      logger.debug({ agent: this.name }, 'Tool-calling Fixer produced no file changes — issues may not be source-fixable');
    }

    return { files };
  }
}
