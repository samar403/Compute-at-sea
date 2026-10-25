import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const production = process.env.NODE_ENV === 'production';

const { app, sim, store } = createApp({
  dbPath: resolve(process.env.DATA_DIR ?? './data', 'compute-at-sea.db'),
  simSpeed: Number(process.env.SIM_SPEED ?? 60),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  bridgeModel: process.env.BRIDGE_MODEL || undefined,
  // dist/server/server/index.js → dist/client
  staticDir: production ? resolve(here, '../../client') : undefined,
});

const server = app.listen(port, () => {
  console.log(`⚓ Compute at Sea listening on http://localhost:${port} (sim ×${sim.simSpeed})`);
  if (!process.env.ANTHROPIC_API_KEY)
    console.log('   Bridge Officer: rules mode (set ANTHROPIC_API_KEY for Claude)');
});

const shutdown = () => {
  sim.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
