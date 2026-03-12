import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import * as pty from 'node-pty';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
const shell = os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/zsh';

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

// WebSocket handling — each connection gets a PTY
wss.on('connection', (ws: WebSocket) => {
  console.log('[harness] WebSocket connected, spawning PTY:', config.command);

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ['-l', '-c', config.command], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: appDir,
      env: (() => {
        const env = { ...process.env, TERM: 'xterm-256color' };
        // Remove Claude Code nesting detection env vars so a fresh session can spawn
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_SESSION;
        return env;
      })() as Record<string, string>,
    });
  } catch (err) {
    console.error('[harness] Failed to spawn PTY:', err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[31m[harness] Failed to spawn PTY: ${err}\x1b[0m\r\n`);
      ws.close();
    }
    return;
  }

  console.log(`[harness] PTY spawned (pid: ${ptyProcess.pid})`);

  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[harness] PTY exited with code ${exitCode}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (data: Buffer | string) => {
    const str = typeof data === 'string' ? data : data.toString();

    // Handle resize messages from the client
    try {
      const msg = JSON.parse(str);
      if (msg.type === 'resize' && msg.cols && msg.rows) {
        ptyProcess.resize(msg.cols, msg.rows);
        return;
      }
    } catch {
      // Not JSON — regular terminal input
    }

    ptyProcess.write(str);
  });

  ws.on('close', () => {
    console.log('[harness] WebSocket closed, killing PTY');
    ptyProcess.kill();
  });
});

server.listen(config.port, () => {
  console.log(`[harness] Listening on http://localhost:${config.port}`);
  console.log(`[harness] App dir: ${appDir}`);
  console.log(`[harness] App iframe: http://localhost:${config.appPort}`);
  console.log(`[harness] Command: ${config.command}`);
});
