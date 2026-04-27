import { z } from 'zod';
import { BaseAgent } from './base-agent.js';
import type { ModelRole, TaskMode, FileChange } from '@rag-system/shared';
import { FileChangeSchema, type FileReadyCallback } from './coder.js';
import { streamFileChanges } from './partial-json.js';

export const FixerOutputSchema = z.object({
  files: z.array(FileChangeSchema),
});

export type FixerOutput = z.infer<typeof FixerOutputSchema>;

export class FixerAgent extends BaseAgent {
  name = 'Fixer';
  role: ModelRole = 'fixer';
  systemPrompt = `You are a Code Fixer. Fix the listed issues with minimal, surgical edits.

OUTPUT FORMAT — same as Coder:

For EDITING existing files (the main case for fixes):
{ "action": "modify", "path": "src/foo.ts", "edits": [
  { "search": "<EXACT current code>", "replace": "<fixed code>" }
] }
  - "search" MUST match the current file byte-for-byte (including whitespace).
  - "search" must be UNIQUE in the file — include surrounding context if needed.
  - Each edit applied in order; later edits see earlier results.
  - You CANNOT delete code not quoted in any "search" — that's the safety guarantee.

For NEW files (rare for Fixer): { "action": "create", "path": "...", "content": "..." }

Rules:
1. The "# Existing project files (READ-ONLY reference)" / "# Recently modified by previous
   steps" blocks are reference. NEVER copy markers or other files' code into your output.
2. Address ONLY the listed issues. Do not rewrite working code to "improve" it.
3. If an issue says "Cannot find name X", restore the missing import or declaration —
   do not delete the code that uses X.
4. Common TypeScript strict fixes:
   - "TS2362/TS2363 left-hand side of arithmetic must be number" on Date subtraction:
     change date1 - date2 to date1.getTime() - date2.getTime() or +date1 - +date2.
   - "Parameter implicitly has an 'any' type": add an explicit type annotation.
   - "Cannot find name 'jest'": replace 'as jest.Mock' with 'as ReturnType<typeof vi.fn>'
     and import vi from 'vitest'.
5. Follow Project Conventions: test framework, .js import suffix, strict mode.

Output ONLY valid JSON:
{ "files": [ <change>, <change>, ... ] }`;

  async execute(
    issues: string[],
    currentFiles: FileChange[],
    context: string,
    taskMode: TaskMode,
    onFileReady?: FileReadyCallback,
  ): Promise<FixerOutput> {
    const issuesList = issues.join('\n- ');
    const filesSummary = currentFiles
      .map(f => formatChangeForFixer(f))
      .join('\n---\n');
    const prompt = `Issues to fix:\n- ${issuesList}\n\nCurrent files:\n${filesSummary}\n\nContext:\n${context}\n\nProvide fixed files JSON.`;

    let full = '';
    let index = 0;
    const tee = (async function *(this: FixerAgent) {
      for await (const chunk of this.streamLLM(prompt, taskMode, true)) {
        full += chunk;
        yield chunk;
      }
    }).call(this);

    if (onFileReady) {
      for await (const file of streamFileChanges(tee)) onFileReady(file, index++);
    } else {
      for await (const _ of tee) { /* drain */ }
    }

    return this.parseAndValidate(full, FixerOutputSchema);
  }
}

function formatChangeForFixer(c: FileChange): string {
  switch (c.action) {
    case 'create':
      return `// ${c.path} (newly created)\n${c.content}`;
    case 'modify':
      return `// ${c.path} (modified with ${c.edits.length} edit(s))\n${c.edits
        .map((e, i) => `[edit ${i + 1}]\nSEARCH:\n${e.search}\nREPLACE:\n${e.replace}`)
        .join('\n')}`;
    case 'delete':
      return `// ${c.path} (deleted)`;
  }
}
