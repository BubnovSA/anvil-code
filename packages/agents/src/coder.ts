import { z } from 'zod';
import { BaseAgent } from './base-agent.js';
import { ModelRole } from '@rag-system/shared';
import { streamFileChanges, type PartialFile } from './partial-json.js';

export const FileEditSchema = z.object({
  search: z.string().min(1),
  replace: z.string(),
});

export const FileChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    path: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    action: z.literal('modify'),
    path: z.string().min(1),
    edits: z.array(FileEditSchema).min(1),
  }),
  z.object({
    action: z.literal('delete'),
    path: z.string().min(1),
  }),
]);

export const CoderOutputSchema = z.object({
  files: z.array(FileChangeSchema),
});

export type CoderOutput = z.infer<typeof CoderOutputSchema>;
export type FileReadyCallback = (file: PartialFile, index: number) => void;

export class CoderAgent extends BaseAgent {
  name = 'Coder';
  role: ModelRole = 'coder';
  systemPrompt = `You are an expert Software Engineer.
Given a plan step and codebase context, generate file changes in JSON.

OUTPUT FORMAT — three actions, each requires different fields:

For NEW files: { "action": "create", "path": "src/foo.ts", "content": "<full file text>" }

For EDITING existing files: { "action": "modify", "path": "src/bar.ts", "edits": [
  { "search": "<EXACT existing code, multi-line OK>", "replace": "<new code>" }
] }
  - The "edits" array is a list of search/replace blocks, applied in order.
  - Each "search" MUST occur exactly ONCE in the current file. Include enough
    surrounding lines (3-5) so the search is unambiguous.
  - Preserve EXACT whitespace, indentation, quote style, and trailing characters.
  - Do NOT include the entire file in "search" — only the region you change.
  - You CANNOT delete code that you don't quote in any "search". This is the
    main reason we use this format: it physically prevents accidental rewrites.
  - For multi-line changes, write the search block with literal "\\n" between lines
    in the JSON string. Match the exact existing whitespace.

For DELETING files: { "action": "delete", "path": "src/old.ts" }

Rules you MUST follow:
1. The "# Existing project files (READ-ONLY reference)" block uses BEGIN FILE / END FILE
   markers ONLY to delimit reference material. NEVER copy these markers, file paths,
   or other files' contents into your output.
1a. The "# Recently modified by previous steps" block (when present) shows the LATEST
    state of files just edited by earlier steps. It SUPERSEDES "Existing project files".
    For modify actions, your "search" strings must match THIS recent content.
2. For "modify", quote the EXACT current code in "search" — do not paraphrase or
   reformat. Whitespace and indentation must match byte-for-byte.
3. Follow the "# Project Conventions" block strictly:
   - Use the specified test framework (e.g. vitest), never jest if vitest is listed.
   - If "Import paths MUST include .js suffix" appears, all relative imports
     in created or replaced code MUST end in .js.
   - Match TypeScript strict mode (no implicit any, explicit types).
4. Make MINIMAL changes. One small "edits" array beats one big "create" rewrite.
   Do not add unrelated refactoring, comments, or console.log.
5. Do NOT write test files in this output — Tester handles tests separately.
6. TypeScript strict patterns:
   - Date arithmetic: use date1.getTime() - date2.getTime() or +date1 - +date2 (TS2362).
   - Use reply.code(N).send(...) for non-200 responses, matching existing error handling.
   - Type request.body / request.params at destructure: const { id } = request.params as { id: string }.
7. NEVER write placeholder comments such as "// Existing code...", "// Assuming X is here",
    "// TODO: implement". Either include the real code or omit the line entirely.
8. File extension rule: source files in TypeScript projects MUST be .ts (or .tsx).
   The .js suffix in import paths is the TS NodeNext convention — it does NOT mean
   the source file is .js. Create modules as .ts; reference them as ./file.js in imports.
9. Fastify quick reference (when "Runtime framework(s)" includes fastify):
   - Hooks (onRequest, preHandler, onSend, onResponse, onError) take EXACTLY 2 args:
     async (request, reply) => {...}. NEVER add 'payload', 'next', or 'done' parameters.
   - Hook registration: app.addHook("onResponse", async (request, reply) => { ... }).
   - Request duration: reply.elapsedTime (number, ms). Don't compute manually.
   - Logging: when Fastify is initialized with logger: true, use app.log.info({...}).
   - Real type exports: FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync,
     FastifyPluginCallback, FastifyPluginOptions, FastifyServerOptions.
     NEVER import: HookHandlerType, RouteGenericInterface, FastifyHook (do not exist).

Output ONLY a valid JSON object matching this schema:
{ "files": [ <change>, <change>, ... ] }
where each <change> is one of the create/modify/delete shapes above.`;

  async execute(
    stepDescription: string,
    context: string,
    taskMode: 'fast'|'balanced'|'deep',
    onFileReady?: FileReadyCallback,
  ): Promise<CoderOutput> {
    const prompt = `Step: ${stepDescription}\n\nContext:\n${context}\n\nGenerate the code changes JSON.`;

    let full = '';
    let index = 0;
    const tee = teeStream(this.streamLLM(prompt, taskMode, true), c => { full += c; });

    if (onFileReady) {
      for await (const file of streamFileChanges(tee)) {
        onFileReady(file, index++);
      }
    } else {
      for await (const _ of tee) { /* no-op */ }
    }

    return this.parseAndValidate(full, CoderOutputSchema);
  }
}

async function *teeStream(
  source: AsyncIterable<string>,
  tap: (chunk: string) => void,
): AsyncIterable<string> {
  for await (const chunk of source) {
    tap(chunk);
    yield chunk;
  }
}
