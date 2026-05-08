import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '@rag-system/shared';
import type { ValidationResult } from './test-runner.js';

export class TypeChecker {
  constructor(
    private projectRoot: string,
    private timeoutMs: number = 120_000,
  ) {}

  async run(): Promise<ValidationResult> {
    const tsconfig = this.findTsconfig();
    if (!tsconfig) {
      return { success: true, output: '', exitCode: 0, durationMs: 0, skipped: 'no tsconfig.json' };
    }

    return this.spawnWithTimeout('npx', ['--no-install', 'tsc', '--noEmit', '-p', tsconfig]);
  }

  /**
   * Run the full project typecheck but report only errors that originate in
   * the specified files. Errors in other files are ignored — the caller only
   * cares about what their edits broke, not pre-existing issues elsewhere.
   *
   * If the specified files have no errors (even if the project as a whole
   * does), returns success:true so the pre-Reviewer check does not block a
   * clean edit because of an unrelated existing failure.
   */
  async runOn(paths: string[]): Promise<ValidationResult> {
    const result = await this.run();
    if (result.success || result.skipped) return result;

    // tsc error lines begin with the relative path: "src/foo.ts(1,2): error …"
    const normalised = paths.map(p => p.replace(/\\/g, '/'));
    const lines = result.output.split('\n');
    const relevant = lines.filter(l => normalised.some(p => l.startsWith(p)));

    if (relevant.length === 0) {
      // Project has errors but none are in our changed files — treat as passed.
      return { success: true, output: '', exitCode: 0, durationMs: result.durationMs };
    }
    return { ...result, output: relevant.join('\n') };
  }

  private findTsconfig(): string | null {
    // Check root, then common monorepo layout
    const rootCfg = path.join(this.projectRoot, 'tsconfig.json');
    if (fs.existsSync(rootCfg)) return rootCfg;
    const baseCfg = path.join(this.projectRoot, 'tsconfig.base.json');
    if (fs.existsSync(baseCfg)) return baseCfg;
    return null;
  }

  private spawnWithTimeout(command: string, args: string[]): Promise<ValidationResult> {
    const start = Date.now();
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: this.projectRoot,
        env: { ...process.env, NO_COLOR: '1' },
      });

      let output = '';
      const append = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 16_384) output = output.slice(-16_384);
      };
      proc.stdout?.on('data', append);
      proc.stderr?.on('data', append);

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        output += `\n[TypeChecker] Killed after ${this.timeoutMs}ms timeout`;
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const exitCode = code ?? 1;
        const success = exitCode === 0;
        logger.info({ exitCode, durationMs, success }, 'TypeChecker finished');
        resolve({ success, output: output.slice(-4000), exitCode, durationMs });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: `Failed to spawn: ${err.message}`,
          exitCode: 1,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
