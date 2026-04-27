import { z } from 'zod';
import { BaseAgent } from './base-agent.js';
import type { ModelRole, TaskMode, FileChange } from '@rag-system/shared';

export const ReviewerOutputSchema = z.object({
  isApproved: z.boolean(),
  issues: z.array(z.string()),
});

export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;

export class ReviewerAgent extends BaseAgent {
  name = 'Reviewer';
  role: ModelRole = 'reviewer';
  systemPrompt = `You are a Code Reviewer. Review code changes for correctness, security, and quality.
Output ONLY valid JSON: { "isApproved": true|false, "issues": ["issue 1", "issue 2"] }
If there are no issues, set isApproved to true and issues to [].`;

  async execute(stepDescription: string, files: FileChange[], context: string, taskMode: TaskMode): Promise<ReviewerOutput> {
    const filesSummary = files.map(formatChangeForReview).join('\n---\n');
    const prompt = `Step: ${stepDescription}\n\nFiles:\n${filesSummary}\n\nContext:\n${context}\n\nProvide review JSON.`;
    const response = await this.callLLM(prompt, taskMode, true);
    return this.parseAndValidate(response, ReviewerOutputSchema);
  }
}

function formatChangeForReview(c: FileChange): string {
  switch (c.action) {
    case 'create':
      return `// ${c.path} (new file)\n${c.content}`;
    case 'modify':
      return `// ${c.path} (${c.edits.length} edit block(s))\n${c.edits
        .map((e, i) => `[edit ${i + 1}]\n--- SEARCH ---\n${e.search}\n--- REPLACE ---\n${e.replace}`)
        .join('\n')}`;
    case 'delete':
      return `// ${c.path} (deleted)`;
  }
}
