import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Provide a minimal config stub so SafeWriter doesn't need the full shared package at test time
vi.mock('@rag-system/shared', () => ({
  config: {
    projectRoot: os.tmpdir(),
    safeExec: { dryRun: false, backup: false, backupsPath: os.tmpdir() },
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub BackupManager and DiffEngine to isolate SafeWriter logic
vi.mock('../backup.js', () => ({ BackupManager: class { backup() {} } }));
vi.mock('../diff-engine.js', () => ({ DiffEngine: class { generate() { return { diff: '' }; } } }));

const { SafeWriter } = await import('../writer.js');

describe('SafeWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-writer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Path traversal protection ──────────────────────────────────────────────

  it('blocks path traversal with ../', () => {
    const writer = new SafeWriter(tmpDir);
    expect(() =>
      writer.execute({ action: 'create', path: '../../etc/passwd', content: '' })
    ).toThrow('Path traversal attempt blocked');
  });

  it('blocks absolute path outside project root', () => {
    const writer = new SafeWriter(tmpDir);
    expect(() =>
      writer.execute({ action: 'create', path: '/etc/passwd', content: '' })
    ).toThrow('Path traversal attempt blocked');
  });

  it('blocks path traversal with encoded segments', () => {
    const writer = new SafeWriter(tmpDir);
    expect(() =>
      writer.execute({ action: 'create', path: 'foo/../../etc/passwd', content: '' })
    ).toThrow('Path traversal attempt blocked');
  });

  // ── Valid operations ───────────────────────────────────────────────────────

  it('creates a file inside project root', () => {
    const writer = new SafeWriter(tmpDir);
    writer.execute({ action: 'create', path: 'src/foo.ts', content: 'export {}' });
    expect(fs.readFileSync(path.join(tmpDir, 'src/foo.ts'), 'utf8')).toBe('export {}');
  });

  it('creates nested directories as needed', () => {
    const writer = new SafeWriter(tmpDir);
    writer.execute({ action: 'create', path: 'a/b/c/file.ts', content: '// hi' });
    expect(fs.existsSync(path.join(tmpDir, 'a/b/c/file.ts'))).toBe(true);
  });

  it('modifies an existing file via edit blocks', () => {
    const filePath = path.join(tmpDir, 'existing.ts');
    fs.writeFileSync(filePath, 'const greeting = "hi";\nexport { greeting };');
    const writer = new SafeWriter(tmpDir);
    writer.execute({
      path: 'existing.ts',
      action: 'modify',
      edits: [{ search: '"hi"', replace: '"hello"' }],
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const greeting = "hello";\nexport { greeting };');
  });

  it('throws when modify search string is not found', () => {
    const filePath = path.join(tmpDir, 'existing.ts');
    fs.writeFileSync(filePath, 'const x = 1;');
    const writer = new SafeWriter(tmpDir);
    expect(() =>
      writer.execute({
        path: 'existing.ts',
        action: 'modify',
        edits: [{ search: 'NOT_THERE', replace: 'foo' }],
      }),
    ).toThrow(/edit-apply failed/);
    // Original file remains untouched
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const x = 1;');
  });

  it('throws when modifying a non-existent file', () => {
    const writer = new SafeWriter(tmpDir);
    expect(() =>
      writer.execute({
        path: 'missing.ts',
        action: 'modify',
        edits: [{ search: 'x', replace: 'y' }],
      }),
    ).toThrow(/non-existent/);
  });

  it('deletes a file', () => {
    const filePath = path.join(tmpDir, 'to-delete.ts');
    fs.writeFileSync(filePath, 'content');
    const writer = new SafeWriter(tmpDir);
    writer.execute({ path: 'to-delete.ts', action: 'delete' });
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
