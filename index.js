#!/usr/bin/env bun

import { watch } from 'fs';

let options = {};
{
  const HELP_MSG = `
Usage: live-bun [--port PORT] [DIR]

Watch and serve DIR lively.  Working directory is served if no DIR specified.

Options:
  -p, --port PORT  Specify the port to use. (Default: 8000)
  --help           Print help text and exit.
`;
  let terminated = false;
  for (let i = 2; i < Bun.argv.length; i++) {
    if (!terminated) {
      switch (Bun.argv[i]) {
        case '--help':
          console.write(HELP_MSG);
          process.exit();
        case '-p':
        case '--port':
          if (options.port) {
            console.error('Repeated port options.');
            process.exit(1);
          }
          options.port = parseInt(Bun.argv[++i], 10);
          if (isNaN(options.port)) {
            console.error('Bad port option.');
            process.exit(1);
          }
          continue;
        case '--':
          terminated = true;
          continue;
        default:
          if (Bun.argv[i][0] === '-') {
            console.error(`Unrecognized option: ${Bun.argv[i]}`);
            process.exit(1);
          }
      }
    }
    if (options.dir) {
      console.error('Multiple DIR specified.');
      process.exit(1);
    }
    options.dir = Bun.argv[i];
    if (!(await Bun.file(options.dir).stat()).isDirectory()) {
      console.error(`Not a directory: ${options.dir}`);
      process.exit(1);
    }
  }
  options = Object.assign({
    port: 8000,
    dir: '.',
  }, options);
}

const injection = await Bun.file(`${import.meta.dir}/injection.html`).text();

let clients = new Set();
let watcher = watch(
  options.dir,
  { recursive: true }
);

watcher.on('change', (event, filename) => {
  let file = Bun.file(filename.toString());
  if (file.type.includes('text/css')) {
    clients.forEach((x) => x.send('refreshCss'));
  } else {
    clients.forEach((x) => x.send('reload'));
  }
});

const server = Bun.serve({
  port: options.port,
  async fetch(req, server) {
    if (req.url.endsWith('ws')) {
      if (server.upgrade(req)) return;
      else return new Response('Failed to upgrade.', { status: 500 });
    }

    let pathname = new URL(req.url).pathname;
    // URLs with no set pathname will serve /index.html by default
    if (pathname === '/') {
      pathname = '/index.html';
    }
    pathname = options.dir + pathname;

    let file = Bun.file(pathname);
    const fileType = file.type;
    // Non-existent file has a type of "text/plain".
    if (fileType.includes('text/html')) {
      file = await file.text();
      let idx = file.search(/<\/body>/i);
      file = file.slice(0, idx) + injection + file.slice(idx);
    }
    return new Response(file, { headers: { 'Content-Type': fileType } });
  },
  error(err) {
    if (err.code === 'ENOENT') {
      return new Response('Not found', { status: 404 });
    } else {
      return new Response('Unexpected error', { status: 500 });
    }
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      console.log(`Connected with ${ws.remoteAddress}`);
    },
    close(ws, code, reason) {
      clients.delete(ws);
      console.log(`Disconnected with ${ws.remoteAddress}`);
    },
    message(ws, message) {},
  },
});

console.log(`Your directory is now living on http://localhost:${options.port}. Press Q to stop the server.`);

process.stdin.setRawMode(true);
process.stdin.on('data', (ch) => {
  if (ch.toString() === 'q') {
    server.stop();
    process.exit();
  }
});
