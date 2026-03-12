import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI args
function parseArgs(args: string[]): {
  appDir: string;
  appPort: number;
  port: number;
  command: string;
} {
  const result = {
    appDir: '.',
    appPort: 8080,
    port: 3333,
    command: 'claude',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--app-dir':
        result.appDir = args[++i];
        break;
      case '--app-port':
        result.appPort = parseInt(args[++i], 10);
        break;
      case '--port':
        result.port = parseInt(args[++i], 10);
        break;
      case '--command':
        result.command = args[++i];
        break;
    }
  }

  return result;
}

const config = parseArgs(process.argv.slice(2));
const appDir = path.resolve(config.appDir);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Read and prepare the HTML template
const htmlPath = path.join(__dirname, 'public', 'index.html');
const htmlTemplate = fs.readFileSync(htmlPath, 'utf-8');

// Serve index.html with appPort injected
app.get('/', (_req, res) => {
  const html = htmlTemplate.replace('__APP_PORT__', String(config.appPort));
  res.type('html').send(html);
});

// WebSocket handling
wss.on('connection', (ws: WebSocket) => {
  console.log('[harness] WebSocket connected, spawning:', config.command);

  const child = spawn(config.command, [], {
    cwd: appDir,
    env: { ...process.env, TERM: 'xterm-256color' },
    shell: true,
  });

  child.stdout.on('data', (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  ws.on('message', (data: Buffer) => {
    if (child.stdin.writable) {
      child.stdin.write(data);
    }
  });

  child.on('exit', (code) => {
    console.log(`[harness] Process exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[harness] WebSocket closed, killing child process');
    child.kill();
  });
});

server.listen(config.port, () => {
  console.log(`[harness] Listening on http://localhost:${config.port}`);
  console.log(`[harness] App dir: ${appDir}`);
  console.log(`[harness] App iframe: http://localhost:${config.appPort}`);
  console.log(`[harness] Command: ${config.command}`);
});
