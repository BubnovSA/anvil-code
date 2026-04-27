export type ModelRole = 'planner' | 'architect' | 'coder' | 'tester' | 'reviewer' | 'fixer';
export type TaskMode = 'fast' | 'balanced' | 'deep';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Search/replace block — Coder/Fixer emit these for `modify` actions instead of
 * the entire file content. The applier finds `search` (must be unique in the
 * current file) and replaces with `replace`. This makes it physically impossible
 * for the model to silently delete code that isn't mentioned in any block.
 */
export interface FileEdit {
  search: string;
  replace: string;
}

/**
 * One change to a single file. Discriminated by `action`:
 * - `create`: full new file content (path must not exist or will be overwritten)
 * - `modify`: list of search/replace edits applied in order to the existing file
 * - `delete`: remove the file
 */
export type FileChange =
  | { action: 'create'; path: string; content: string }
  | { action: 'modify'; path: string; edits: FileEdit[] }
  | { action: 'delete'; path: string };

export interface DiffResult {
  path: string;
  diff: string;
}

export interface TaskDefinition {
  id: string;
  description: string;
  mode: TaskMode;
  createdAt: string;
}
