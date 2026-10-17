import { serve, type ServerType } from '@hono/node-server';
import { ConfigError, loadConfig } from './config.js';
import { createAppContext } from './context.js';
import { createHttpApp } from './http/app.js';

const MAINTENANCE_INTERVAL_MS = 60 * 60_000;

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[bistro] configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const app = createAppContext(config);
  const servers: ServerType[] = [
    serve({ fetch: createHttpApp(app, 'public').fetch, port: config.publicPort, hostname: config.host }, (info) =>
      app.log(`public listener on ${info.address}:${info.port}`),
    ),
    serve({ fetch: createHttpApp(app, 'admin').fetch, port: config.adminPort, hostname: config.host }, (info) =>
      app.log(`internal listener on ${info.address}:${info.port}`),
    ),
  ];

  app.worker.start();

  const maintenance = setInterval(() => {
    const now = app.clock();
    app.repos.sessions.purgeExpired(now);
    app.repos.idempotency.purgeOlderThan(new Date(now.getTime() - 7 * 24 * 60 * 60_000));
    app.repos.geoCache.purgeExpired(now);
  }, MAINTENANCE_INTERVAL_MS);
  maintenance.unref();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log(`received ${signal}, shutting down`);
    clearInterval(maintenance);
    for (const server of servers) server.close();
    void app.worker.stop().finally(() => {
      app.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
