import { watch } from 'fs';

let options = {};
for (let i = 2; i < Bun.argv.length; i++) {
  switch (Bun.argv[i]) {
    case '--help':
      console.write(`
Usage: bun run . [--port PORT] [--help]

Options:
  -p, --port PORT  Specify the port to use. (Default: 8000)
  --help           Print help text and exit.
`);
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
      break;
    default:
      console.error('Unrecognized argument(s).');
      process.exit(1);
  }
}
options.port ??= 8000;

const injection = await Bun.file(`${import.meta.dir}/injection.html`).text();

let clients = [];
let watcher = watch(
  '.',
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
      pathname = "/index.html"
    }

    const filePath = '.' + pathname;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      let content = await file.bytes();
      if (file.type.includes('text/html')) {
        const textDecoder = new TextDecoder();
        let textContent = textDecoder.decode(content.buffer);
        let idx = textContent.search(/<\/body>/i);
        content = ''.concat(textContent.slice(0, idx), injection, textContent.slice(idx));
      }
      return new Response(content, { headers: { 'Content-Type': file.type } });
    } else {
      return new Response('No such file or directory.', { status: 404 });
    }
  },
  websocket: {
    open(ws) {
      clients.push(ws);
      console.log(`Connected with ${ws.remoteAddress}`);
    },
    close(ws, code, reason) {
      clients = clients.filter((x) => x !== ws);
      console.log(`Disconnected with ${ws.remoteAddress}`);
    },
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
