import { config, logger, validateConfig } from '@rag-system/shared';
import { ModelRouter, createChatBackend } from '@rag-system/model-router';
import { ProjectRegistry } from '@rag-system/memory';
import { FileWatcher } from '@rag-system/rag';
import { ProjectManager } from '@rag-system/agents';
import { MemoryQueue, JobWorker } from '@rag-system/job-system';
import { buildServer } from './server.js';

async function main() {
  validateConfig();

  // v1.32-d — backend factory selects between OllamaClient and LlamaSwapClient
  // based on LLM_BACKEND env. Health check the active backend on startup so a
  // misconfigured URL surfaces in the log instead of failing the first task.
  const backend = createChatBackend();
  const isUp = await backend.healthCheck();
  const backendUrl = config.llmBackend === 'llamacpp' ? config.llamacpp.url : config.ollama.baseUrl;
  if (!isUp) {
    logger.warn(
      { backend: config.llmBackend, url: backendUrl },
      'LLM backend not available — tasks will fail until it is running',
    );
  } else {
    logger.info({ backend: config.llmBackend, url: backendUrl }, 'LLM backend connected');
  }

  const router = new ModelRouter(backend);
  const registry = new ProjectRegistry();
  const projects = new ProjectManager(registry, router);

  // Auto-register the configured PROJECT_ROOT as the default project, so a fresh
  // install behaves identically to single-project mode without manual setup.
  let defaultProject = registry.list()[0];
  if (config.projects.autoRegisterDefault && !defaultProject) {
    defaultProject = registry.register(config.projectRoot);
    logger.info(
      { projectId: defaultProject.id, root: defaultProject.root },
      'Auto-registered default project',
    );
  }
  if (!defaultProject) {
    throw new Error('No projects registered and PROJECTS_AUTO_REGISTER_DEFAULT=false');
  }

  // Eagerly warm the default context so the first task doesn't pay startup cost
  await projects.get(defaultProject.id);

  const queue = new MemoryQueue();
  const worker = new JobWorker(queue, async (projectId) => {
    const ctx = await projects.get(projectId);
    return { orchestrator: ctx.orchestrator, store: ctx.store };
  });

  worker.start();

  let watcher: FileWatcher | null = null;
  if (config.watcher.enabled) {
    const ctx = await projects.get(defaultProject.id);
    watcher = new FileWatcher(ctx.retriever);
    watcher.start();
  }

  // Backup rotation: prune all loaded project backup dirs on a long interval.
  const pruneAll = () => {
    for (const ctx of projects.loaded()) ctx.backups.prune();
  };
  pruneAll();
  const pruneTimer = setInterval(pruneAll, config.safeExec.backupPruneIntervalMs);
  pruneTimer.unref();

  const server = buildServer({
    queue,
    registry,
    projects,
    defaultProjectId: defaultProject.id,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    clearInterval(pruneTimer);
    worker.stop();
    if (watcher) await watcher.stop();
    projects.closeAll();
    registry.close();
    await server.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    await server.listen({ port: config.api.port, host: config.api.host });
    logger.info(`RAG System API running on http://${config.api.host}:${config.api.port}`);
    logger.info('Endpoints: POST /task  GET /task/:id  GET /tasks  GET /health');
  } catch (err) {
    logger.error(err, 'Failed to start API server');
    process.exit(1);
  }
}

main().catch(err => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
