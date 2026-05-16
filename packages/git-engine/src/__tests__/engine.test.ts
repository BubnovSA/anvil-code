import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @rag-system/shared so each test can flip cumulative.enabled without
// leaking via env vars. simple-git is mocked to a hand-rolled spy harness so
// we can assert exactly which calls fired in which order.
const mockConfig = {
  git: {
    defaultBranch: 'main',
    cumulative: {
      enabled: false,
      branch: 'auto/cumulative',
    },
  },
};

vi.mock('@rag-system/shared', () => ({
  config: mockConfig,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface GitSpy {
  checkout: ReturnType<typeof vi.fn>;
  checkoutLocalBranch: ReturnType<typeof vi.fn>;
  branch: ReturnType<typeof vi.fn>;
  merge: ReturnType<typeof vi.fn>;
  clean: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
}

let gitSpy: GitSpy;

vi.mock('simple-git', () => ({
  simpleGit: () => gitSpy,
}));

const { GitEngine } = await import('../engine.js');

function makeGitSpy(overrides: Partial<GitSpy> = {}): GitSpy {
  return {
    checkout: vi.fn().mockResolvedValue(undefined),
    checkoutLocalBranch: vi.fn().mockResolvedValue(undefined),
    branch: vi.fn().mockResolvedValue({ all: [] }),
    merge: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
    status: vi.fn().mockResolvedValue({ modified: [] }),
    ...overrides,
  };
}

describe('GitEngine — cumulative mode (v1.39-a)', () => {
  beforeEach(() => {
    mockConfig.git.cumulative.enabled = false;
    mockConfig.git.cumulative.branch = 'auto/cumulative';
    mockConfig.git.defaultBranch = 'main';
  });

  it('createBranchForTask forks from defaultBranch when cumulative disabled', async () => {
    gitSpy = makeGitSpy();
    const engine = new GitEngine('/tmp');

    const branch = await engine.createBranchForTask('t1');

    expect(branch).toMatch(/^auto\/task-t1-\d+$/);
    expect(gitSpy.checkout).toHaveBeenCalledWith(['-f', 'main']);
    expect(gitSpy.clean).toHaveBeenCalledWith('f', ['-d']);
    // No branch lookup or auto-creation should happen in non-cumulative mode.
    expect(gitSpy.branch).not.toHaveBeenCalled();
    expect(gitSpy.checkoutLocalBranch).toHaveBeenCalledWith(branch);
  });

  it('createBranchForTask creates cumulative branch on first use', async () => {
    mockConfig.git.cumulative.enabled = true;
    gitSpy = makeGitSpy({
      branch: vi.fn().mockResolvedValue({ all: [] }), // cumulative does not exist yet
    });
    const engine = new GitEngine('/tmp');

    const branch = await engine.createBranchForTask('t1');

    // Bootstrap path: branch is created from defaultBranch, then the task
    // branch forks off it. The order matters — checkout main → create
    // cumulative → checkout cumulative → fork task branch.
    expect(gitSpy.branch).toHaveBeenCalledWith(['--list', 'auto/cumulative']);
    const localBranchCalls = gitSpy.checkoutLocalBranch.mock.calls.map(c => c[0]);
    expect(localBranchCalls).toContain('auto/cumulative');
    expect(localBranchCalls).toContain(branch);
    expect(branch).toMatch(/^auto\/task-t1-\d+$/);
  });

  it('createBranchForTask reuses cumulative branch when it exists', async () => {
    mockConfig.git.cumulative.enabled = true;
    gitSpy = makeGitSpy({
      branch: vi.fn().mockResolvedValue({ all: ['auto/cumulative'] }),
    });
    const engine = new GitEngine('/tmp');

    const branch = await engine.createBranchForTask('t2');

    // Only the task branch is created locally — cumulative is just checked out.
    const localBranchCalls = gitSpy.checkoutLocalBranch.mock.calls.map(c => c[0]);
    expect(localBranchCalls).toEqual([branch]);
    expect(gitSpy.checkout).toHaveBeenCalledWith(['-f', 'auto/cumulative']);
  });

  it('mergeIntoCumulative ff-merges and returns void on success', async () => {
    mockConfig.git.cumulative.enabled = true;
    gitSpy = makeGitSpy();
    const engine = new GitEngine('/tmp');

    await engine.mergeIntoCumulative('auto/task-x-123');

    expect(gitSpy.checkout).toHaveBeenCalledWith('auto/cumulative');
    expect(gitSpy.merge).toHaveBeenCalledWith(['--ff-only', 'auto/task-x-123']);
  });

  it('mergeIntoCumulative throws on non-ff (so caller can abort/mark failed)', async () => {
    mockConfig.git.cumulative.enabled = true;
    gitSpy = makeGitSpy({
      merge: vi.fn().mockRejectedValue(new Error('not possible to fast-forward')),
    });
    const engine = new GitEngine('/tmp');

    await expect(engine.mergeIntoCumulative('auto/task-x-123')).rejects.toThrow(
      /Cumulative ff-merge of auto\/task-x-123 failed/,
    );
  });
});

describe('GitEngine — commitChanges pre-commit hook retry (v1.58)', () => {
  beforeEach(() => {
    mockConfig.git.cumulative.enabled = false;
    mockConfig.git.defaultBranch = 'main';
  });

  it('commits successfully on first attempt', async () => {
    gitSpy = makeGitSpy();
    const engine = new GitEngine('/tmp');
    const hash = await engine.commitChanges('t1', 'test commit', ['src/foo.ts']);
    expect(hash).toBe('abc123');
    expect(gitSpy.add).toHaveBeenCalledWith(['src/foo.ts']);
    expect(gitSpy.commit).toHaveBeenCalledTimes(1);
  });

  it('re-stages and retries when pre-commit hook reformats files', async () => {
    gitSpy = makeGitSpy({
      commit: vi.fn()
        .mockRejectedValueOnce(new Error('hook exited with code 1'))
        .mockResolvedValueOnce({ commit: 'def456' }),
      status: vi.fn().mockResolvedValue({ modified: ['src/foo.ts'] }),
    });
    const engine = new GitEngine('/tmp');
    const hash = await engine.commitChanges('t1', 'test', ['src/foo.ts']);
    expect(hash).toBe('def456');
    expect(gitSpy.add).toHaveBeenCalledTimes(2);
    expect(gitSpy.commit).toHaveBeenCalledTimes(2);
  });

  it('throws if no modified files after first commit failure (real error)', async () => {
    gitSpy = makeGitSpy({
      commit: vi.fn().mockRejectedValue(new Error('nothing to commit')),
      status: vi.fn().mockResolvedValue({ modified: [] }),
    });
    const engine = new GitEngine('/tmp');
    await expect(engine.commitChanges('t1', 'test', ['src/foo.ts'])).rejects.toThrow('nothing to commit');
    expect(gitSpy.commit).toHaveBeenCalledTimes(1);
  });

  it('throws if retry also fails', async () => {
    gitSpy = makeGitSpy({
      commit: vi.fn().mockRejectedValue(new Error('hook failed')),
      status: vi.fn().mockResolvedValue({ modified: ['src/foo.ts'] }),
    });
    const engine = new GitEngine('/tmp');
    await expect(engine.commitChanges('t1', 'test', ['src/foo.ts'])).rejects.toThrow('hook failed');
    expect(gitSpy.commit).toHaveBeenCalledTimes(2);
  });
});
