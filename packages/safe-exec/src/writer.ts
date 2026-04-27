import fs from 'fs';
import path from 'path';
import { config, logger } from '@rag-system/shared';
import type { FileChange } from '@rag-system/shared';
import { BackupManager } from './backup.js';
import { DiffEngine } from './diff-engine.js';
import { applyEdits } from './edit-applier.js';

export class SafeWriter {
  private backup: BackupManager;
  private diff: DiffEngine;
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = path.resolve(projectRoot ?? config.projectRoot);
    this.backup = new BackupManager();
    this.diff = new DiffEngine();
  }

  get root(): string {
    return this.projectRoot;
  }

  execute(change: FileChange): void {
    const resolved = this.resolveSafe(change.path);

    if (config.safeExec.dryRun) {
      logger.info({ path: change.path, action: change.action }, '[DRY-RUN] Would apply change');
      return;
    }

    switch (change.action) {
      case 'delete':
        this.backup.backup(resolved);
        if (fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
          logger.info({ path: change.path }, 'File deleted');
        }
        return;

      case 'create': {
        // Overwrite-on-create is intentional: agents may emit `create` for files
        // that an earlier step in the same task produced. Backup is taken first
        // so the prior state is recoverable.
        const original = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : '';
        this.backup.backup(resolved);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, change.content, 'utf8');
        const result = this.diff.generate(original, change.content, change.path);
        const changedLines = (result.diff.match(/^[+-]/gm) ?? []).length;
        logger.info({ path: change.path, action: 'create', changedLines }, 'File written');
        return;
      }

      case 'modify': {
        if (!fs.existsSync(resolved)) {
          throw new Error(`Cannot modify non-existent file: ${change.path}`);
        }
        const original = fs.readFileSync(resolved, 'utf8');
        const applied = applyEdits(original, change.edits);
        if (!applied.ok) {
          throw new Error(`SafeWriter.execute: edit-apply failed for ${change.path}: ${applied.error}`);
        }
        this.backup.backup(resolved);
        fs.writeFileSync(resolved, applied.result, 'utf8');
        const result = this.diff.generate(original, applied.result, change.path);
        const changedLines = (result.diff.match(/^[+-]/gm) ?? []).length;
        if (applied.tolerantEdits.length > 0) {
          logger.warn(
            {
              path: change.path,
              tolerantEditIndices: applied.tolerantEdits,
              editCount: change.edits.length,
            },
            'Edits matched only via whitespace-tolerant fallback — model likely minified search blocks',
          );
        }
        logger.info(
          { path: change.path, action: 'modify', editCount: change.edits.length, changedLines },
          'File patched',
        );
        return;
      }
    }
  }

  private resolveSafe(filePath: string): string {
    const resolved = path.resolve(this.projectRoot, filePath);
    if (!resolved.startsWith(this.projectRoot + path.sep) && resolved !== this.projectRoot) {
      throw new Error(`Path traversal attempt blocked: ${filePath}`);
    }
    return resolved;
  }
}
