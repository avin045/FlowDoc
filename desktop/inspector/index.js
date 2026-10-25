// Spawns the platform accessibility helper and turns it into a promise API:
//   await inspector.elementAt(x, y)  -> element info under a physical screen point
//   await inspector.focused()        -> element with keyboard focus
// Every call resolves (to null on timeout or failure) so capture never stalls.
import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// Inside a packaged app the helpers are unpacked next to app.asar.
const here = dirname(fileURLToPath(import.meta.url)).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function helperCommand() {
  if (process.platform === 'win32') {
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'windows.ps1')]];
  }
  if (process.platform === 'linux') return ['python3', ['-u', join(here, 'linux.py')]];
  return null;
}

const CONTAINER_TYPES = new Set(['Document', 'Pane', 'Window', 'Custom', 'Group', 'Client', 'Frame']);
function isBareContainer(el) {
  if (!el) return false;
  return CONTAINER_TYPES.has(el.type) && (!el.name || el.name === el.window) && !el.parentName;
}

export function createInspector({ timeout = 1500, log = () => {} } = {}) {
  let child = null;
  let nextId = 1;
  const pending = new Map();
  let available = null; // null = unknown, true/false once probed

  function start() {
    if (child) return;
    const cmd = helperCommand();
    if (!cmd || (process.platform === 'win32' && !existsSync(cmd[1].at(-1)))) {
      available = false;
      return;
    }
    try {
      child = spawn(cmd[0], cmd[1], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      log(`inspector spawn failed: ${err.message}`);
      available = false;
      return;
    }
    child.on('error', (err) => {
      log(`inspector error: ${err.message}`);
      available = false;
      child = null;
    });
    child.on('exit', () => {
      child = null;
      for (const { resolve } of pending.values()) resolve(null);
      pending.clear();
    });
    child.stderr.on('data', (d) => log(`inspector: ${String(d).trim()}`));
    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        if (String(msg.error).startsWith('atspi-unavailable')) available = false;
        p.resolve(null);
      } else p.resolve(msg.el ?? msg.ok ?? null);
    });
  }

  function call(op, args = {}, ms = timeout) {
    start();
    if (!child) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, ms);
      pending.set(id, { resolve, timer });
      child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    });
  }

  // Linux fallback when AT-SPI isn't installed: window title + app via xdotool.
  function activeWindowFallback() {
    if (process.platform !== 'linux') return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile('xdotool', ['getactivewindow', 'getwindowname', 'getwindowpid'], { timeout: 800 }, (err, stdout) => {
        if (err) return resolve(null);
        const [title, pid] = stdout.trim().split('\n');
        let app = '';
        try {
          app = pid ? String(readFileSync(`/proc/${pid}/comm`)).trim() : '';
        } catch {}
        resolve({ name: '', type: 'Window', window: title || '', app, fallback: true });
      });
    });
  }

  return {
    start,
    // Spawning PowerShell/Python takes a moment; warm it up before capture starts.
    async warmUp() {
      const ok = await call('ping', {}, 15000);
      available = !!ok;
      return available;
    },
    get available() {
      return available;
    },
    async elementAt(x, y) {
      if (available === false) return activeWindowFallback();
      const args = { x: Math.round(x), y: Math.round(y) };
      let el = await call('point', args);
      // Chromium-based apps (Chrome, Edge, VS Code, Teams...) only build their
      // accessibility tree once a client asks, so the first answers are often
      // just the window. Ask again, a little more patiently each time, before
      // settling for that. (The screenshot was already taken at mouse-down.)
      for (const wait of [150, 350, 700]) {
        if (!isBareContainer(el)) break;
        await new Promise((r) => setTimeout(r, wait));
        const again = await call('point', args);
        if (again && !isBareContainer(again)) el = again;
      }
      return el || activeWindowFallback();
    },
    async focused() {
      const el = available === false ? null : await call('focus');
      return el || null;
    },
    stop() {
      if (child) {
        child.stdin.end();
        child.kill();
        child = null;
      }
    },
  };
}
