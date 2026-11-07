// Screen capture. A hidden window keeps a low-frame-rate live stream of every
// display open while recording, so a frame can be grabbed the instant a mouse
// button goes down — before the click has changed anything on screen.
// Falls back to desktopCapturer thumbnails (slower) if streaming fails.
import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import { join } from 'node:path';

export function createCapture({ dir, log = () => {} }) {
  let win = null;
  let streaming = false;
  let nextId = 1;
  let only = null; // display ids to stream (an area capture needs one), or null for all

  // Replies from the capture window carry an id; only that window may send them.
  const fromCaptureWindow = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
  function reply(channel, fn) {
    const listener = (e, payload) => {
      if (!fromCaptureWindow(e)) return;
      ipcMain.removeListener(channel, listener);
      fn(payload);
    };
    ipcMain.on(channel, listener);
  }

  async function sources() {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const displays = screen.getAllDisplays().filter((d) => !only || only.includes(d.id));
    // Map each display to its capture source (display_id is empty on some Linux setups).
    return displays.map((d, i) => {
      const src = list.find((s) => s.display_id && String(s.display_id) === String(d.id)) || list[i] || list[0];
      return {
        displayId: d.id,
        sourceId: src?.id,
        width: Math.round(d.size.width * d.scaleFactor),
        height: Math.round(d.size.height * d.scaleFactor),
      };
    });
  }

  // `displayIds` limits the live streams to those displays (each stream costs
  // CPU for as long as the capture runs); shots of other displays then come
  // from a one-off grab.
  async function start(displayIds = null) {
    only = displayIds?.length ? [...displayIds] : null;
    if (win) return streaming;
    win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      webPreferences: { preload: join(dir, 'capture-preload.cjs'), backgroundThrottling: false, contextIsolation: true },
    });
    await win.loadFile(join(dir, 'capture.html'));
    try {
      const result = await win.webContents.executeJavaScript(`window.captureStart(${JSON.stringify(await sources())})`);
      streaming = result.ok;
      if (!result.ok) log(`stream capture unavailable: ${result.error}`);
    } catch (err) {
      streaming = false;
      log(`stream capture failed: ${err.message}`);
    }
    return streaming;
  }

  async function grabViaThumbnail(display) {
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = list.find((s) => String(s.display_id) === String(display.id)) || list[0];
    if (!src) return null;
    const img = src.thumbnail;
    const { width, height } = img.getSize();
    return { dataUrl: `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`, width, height };
  }

  // Returns { dataUrl, width, height } for the given Electron display.
  // `cover` keeps a window that other apps may see (the recorder bar) out of
  // this shot: { rect } in fractions of the display, plus hide() and show(),
  // which take it out of screen captures for a moment. The frame is still the
  // one from the instant of the grab; only the bar's spot is filled in from a
  // frame taken while the bar was hidden. Such frames carry `barHidden: true`.
  async function grab(display, { cover } = {}) {
    if (win && streaming) {
      const id = nextId++;
      // Another shot may have the bar hidden right now. Keep it hidden through
      // this one too, so that shot can't show the bar again while this one
      // waits for a frame without it (capture-renderer.js also tells the bar
      // coming back apart from it going away).
      let hidden = false;
      if (cover?.active?.()) {
        cover.hide();
        hidden = true;
      }
      const result = await new Promise((resolve) => {
        const done = (frame) => {
          clearTimeout(timer);
          ipcMain.removeAllListeners(`capture:frame:${id}`);
          ipcMain.removeAllListeners(`capture:held:${id}`);
          resolve(frame);
        };
        const timer = setTimeout(() => done(null), 2000);
        reply(`capture:frame:${id}`, (frame) => done(frame));
        // The renderer has kept the frame; hide the bar, then let it fill the spot.
        reply(`capture:held:${id}`, () => {
          if (!hidden) cover.hide();
          hidden = true;
          win?.webContents.send('capture:patch', { id });
        });
        win.webContents.send('capture:grab', { id, displayId: display.id, patch: cover?.rect || null });
      });
      if (hidden) cover.show();
      if (result?.dataUrl) return result;
    }
    try {
      if (!cover) return await grabViaThumbnail(display);
      cover.hide();
      try {
        await new Promise((r) => setTimeout(r, 150));
        const frame = await grabViaThumbnail(display);
        return frame && { ...frame, barHidden: true };
      } finally {
        cover.show();
      }
    } catch (err) {
      log(`screenshot failed: ${err.message}`);
      return null;
    }
  }

  // Streams only these displays from now on (an area moved to another display).
  async function setDisplays(displayIds) {
    only = displayIds?.length ? [...displayIds] : null;
    if (!win || win.isDestroyed()) return streaming;
    try {
      const result = await win.webContents.executeJavaScript(`window.captureStart(${JSON.stringify(await sources())}, { replace: true })`);
      streaming = result.ok;
    } catch (err) {
      log(`stream capture failed: ${err.message}`);
      streaming = false;
    }
    return streaming;
  }

  // Whether two shots differ (see recorder.js shotsDiffer for the rules). The
  // capture window does the work, so decoding two full-screen images doesn't
  // hold up the main process; null when it can't (then the caller does it).
  function diff(a, b, region, masks) {
    if (!win || win.isDestroyed()) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(`capture:diff:${id}`);
        resolve(null);
      }, 3000);
      reply(`capture:diff:${id}`, (result) => {
        clearTimeout(timer);
        resolve(typeof result === 'boolean' ? result : null);
      });
      win.webContents.send('capture:diff', { id, a, b, region, masks });
    });
  }

  function stop() {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    streaming = false;
    only = null;
  }

  return { start, setDisplays, grab, diff, stop, get streaming() { return streaming; } };
}
