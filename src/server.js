import { resolve } from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const host = process.env.HOST ?? '127.0.0.1';
const { server } = createApp({
  databasePath: process.env.DATABASE_PATH ?? resolve('data', 'tasks.db'),
  environment: process.env.APP_ENV ?? 'development',
  version: process.env.APP_VERSION ?? 'dev',
});

server.listen(port, host, () => console.log(`Taskboard is running at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.log(`Received ${signal}; closing Taskboard.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
