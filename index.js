import { watch } from 'fs';

const injection = await Bun.file('injection.html').text();

let clients = [];
let watcher = watch('.');
watcher.on('change', (event, filename) => {
  let file = Bun.file(filename.toString());
  if (file.type.includes('text/css')) {
    clients.forEach((x) => x.send('refreshCss'));
  } else {
    clients.forEach((x) => x.send('reload'));
  }
});

const server = Bun.serve({
  port: '8000',
  async fetch(req, server) {
    if (req.url.endsWith('ws')) {
      if (server.upgrade(req)) return;
      else return new Response('Failed to upgrade.', { status: 500 });
    }

    let pathname = '.' + new URL(req.url).pathname;
    let file = Bun.file(pathname);
    if (await file.exists()) {
      let content = await file.text();
      if (file.type.includes('text/html')) {
        let idx = content.search(/<\/body>/i);
        content = ''.concat(content.slice(0, idx), injection, content.slice(idx));
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

process.stdin.setRawMode(true);
process.stdin.on('data', (ch) => {
  if (ch.toString() === 'q') {
    server.stop();
    process.exit();
  }
});
