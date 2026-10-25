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

  async function sources() {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const displays = screen.getAllDisplays();
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

  async function start() {
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
  async function grab(display) {
    if (win && streaming) {
      const id = nextId++;
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          ipcMain.removeAllListeners(`capture:frame:${id}`);
          resolve(null);
        }, 1500);
        ipcMain.once(`capture:frame:${id}`, (_e, frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
        win.webContents.send('capture:grab', { id, displayId: display.id });
      });
      if (result?.dataUrl) return result;
    }
    try {
      return await grabViaThumbnail(display);
    } catch (err) {
      log(`screenshot failed: ${err.message}`);
      return null;
    }
  }

  function stop() {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    streaming = false;
  }

  return { start, grab, stop, get streaming() { return streaming; } };
}
