import * as http from 'node:http';
import { createRequestListener } from 'remix/node-fetch-server';

import { assets } from './app/assets.ts';
import { router } from './app/router.ts';

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100;
const host = process.env.HOST ?? '127.0.0.1';
const server = http.createServer(createRequestListener(router.fetch));
server.listen(port, host, () => console.log(`listening on http://${host}:${port}`));

const shutdown = () => {
  server.close(() => assets.close().finally(() => process.exit(0)));
  server.closeAllConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
