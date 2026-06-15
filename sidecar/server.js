#!/usr/bin/env node

const { startServer } = require('../index');

startServer({
    port: Number(process.env.PORT) || 0,
    host: process.env.HOST || '127.0.0.1',
    silent: true,
}).then(({ port, host, hasFFmpeg }) => {
    process.stdout.write(JSON.stringify({
        event: 'ready',
        url: `http://${host}:${port}`,
        hasFFmpeg,
    }) + '\n');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
