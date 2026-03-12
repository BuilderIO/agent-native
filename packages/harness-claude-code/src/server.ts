import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import fs from 'fs';

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

// Read app package.json for name
let appName = path.basename(appDir);
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
  if (pkg.name) appName = pkg.name.replace(/^@[^/]+\//, ''); // strip scope
} catch {}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/api/app-info') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ name: appName, dir: appDir }));
    return;
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server, path: '/ws' });

// WebSocket handling — each connection gets a PTY
wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const extraFlags = url.searchParams.get('flags') || '';
  const fullCommand = extraFlags ? `${config.command} ${extraFlags}` : config.command;
  console.log('[harness] WebSocket connected, spawning PTY:', fullCommand);

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ['-l', '-c', fullCommand], {
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
  console.log(`[harness] WebSocket server on ws://localhost:${config.port}/ws`);
  console.log(`[harness] App dir: ${appDir}`);
  console.log(`[harness] Command: ${config.command}`);
});
