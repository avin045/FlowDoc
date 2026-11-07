// Runs inside the hidden capture window (capture.html).
// One <video> per display; grabbing draws the current frame to a canvas.
const streams = new Map(); // displayId -> { video, stream }

// `replace`: stream exactly these displays, stopping any others.
window.captureStart = async (sources, { replace = false } = {}) => {
  try {
    if (replace) {
      const keep = new Set(sources.map((s) => s.displayId));
      for (const [id, { stream, video }] of streams) {
        if (keep.has(id)) continue;
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        streams.delete(id);
      }
    }
    for (const s of sources) {
      if (!s.sourceId || streams.has(s.displayId)) continue;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: s.sourceId,
            minWidth: s.width,
            maxWidth: s.width,
            minHeight: s.height,
            maxHeight: s.height,
            maxFrameRate: 10,
          },
        },
      });
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      streams.set(s.displayId, { video, stream });
    }
    return { ok: streams.size > 0 };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
};

const canvas = document.createElement('canvas');

// Shots are stored as WebP: about a third smaller than JPEG at the same
// quality for screens full of text and flat colour. JPEG if WebP isn't there.
function encode(c) {
  const webp = c.toDataURL('image/webp', 0.86);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.88);
}
const send = (id, c, extra = {}) => window.flowdocCapture.sendFrame(id, { dataUrl: encode(c), width: c.width, height: c.height, ...extra });

// Shots that keep the recorder bar out wait here while the bar is hidden from captures.
const held = new Map(); // id -> { video, c, box, bar }

const nextFrame = (video, ms) =>
  new Promise((resolve) => {
    const end = setTimeout(() => resolve(false), ms);
    video.requestVideoFrameCallback(() => {
      clearTimeout(end);
      resolve(true);
    });
  });

// The bar's spot in a frame, as pixels to compare.
const scratch = document.createElement('canvas');
function spotPixels(source, { x, y, w, h }) {
  scratch.width = w;
  scratch.height = h;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, x, y, w, h, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}
function meanDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / (a.length / 4);
}

window.flowdocCapture.onGrab(({ id, displayId, patch }) => {
  // A display that isn't streamed (an area capture streams only its own, or
  // one plugged in since): no frame, so the main process grabs it another way.
  const entry = streams.get(displayId);
  if (!entry || !entry.video.videoWidth) {
    window.flowdocCapture.sendFrame(id, null);
    return;
  }
  const { video } = entry;
  const c = patch ? document.createElement('canvas') : canvas;
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  if (!patch) return send(id, c);
  const x = Math.max(0, Math.floor(patch.x * c.width));
  const y = Math.max(0, Math.floor(patch.y * c.height));
  const box = { x, y, w: Math.min(c.width - x, Math.ceil(patch.w * c.width) + 1), h: Math.min(c.height - y, Math.ceil(patch.h * c.height) + 1) };
  if (box.w <= 0 || box.h <= 0) return send(id, c);
  const spot = spotPixels(c, box);
  // The frame already shows the spot as it was last seen without the bar
  // (another shot has it hidden right now): nothing to fill in.
  if (seen.key === boxKey(box) && seen.clear && meanDiff(spot, seen.clear) < 24) return send(id, c, { barHidden: true });
  held.set(id, { video, c, box, bar: spot });
  window.flowdocCapture.sendHeld(id);
});

// The bar's spot as last seen without the bar and with it, from the last shot
// that filled it in. Shots can overlap: while one waits for the bar to go, the
// bar may come back from another one, and that must not count as it going.
let seen = { key: '', clear: null, bar: null };
const boxKey = (b) => `${b.x},${b.y},${b.w},${b.h}`;

// The bar is being hidden from captures. Frames already on their way may still
// show it, so wait for one where its spot has changed, and copy that spot in.
// If none comes in time, the bar stays in the shot (and gets blurred).
window.flowdocCapture.onPatch(async ({ id }) => {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  const { video, c, box, bar } = h;
  const key = boxKey(box);
  const end = Date.now() + 800;
  while (Date.now() < end) {
    if (!(await nextFrame(video, end - Date.now()))) break;
    const now = spotPixels(video, box);
    if (meanDiff(now, bar) < 24) continue;
    if (seen.key === key && seen.bar && meanDiff(now, seen.bar) < 24) continue; // the bar coming back
    c.getContext('2d').drawImage(video, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    seen = { key, clear: now, bar };
    return send(id, c, { barHidden: true });
  }
  send(id, c);
});

// ---------- comparing two shots (recorder.js shotsDiffer, run here) ----------

// Decoded off the main process: a full-screen image takes a while to decode,
// and the main process handles every window and the input hook meanwhile.
async function pixelsOf(dataUrl, box) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const r = box || { x: 0, y: 0, w: 1, h: 1 };
    const b = { x: Math.round(r.x * W), y: Math.round(r.y * H), width: Math.max(1, Math.round(r.w * W)), height: Math.max(1, Math.round(r.h * H)) };
    b.width = Math.min(b.width, W - b.x);
    b.height = Math.min(b.height, H - b.y);
    if (b.width <= 0 || b.height <= 0) return { W, H, b, data: null };
    const c = new OffscreenCanvas(b.width, b.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    return { W, H, b, data: g.getImageData(0, 0, b.width, b.height).data };
  } finally {
    bitmap.close();
  }
}

async function differ(a, b, region, masks = []) {
  const [pa, pb] = await Promise.all([pixelsOf(a, region), pixelsOf(b, region)]);
  if (!pa.W || !pa.H || pa.W !== pb.W || pa.H !== pb.H || !pa.data || !pb.data) return true;
  const { W, H, b: box } = pa;
  const skip = masks.map((m) => ({ x1: m.x * W - box.x, y1: m.y * H - box.y, x2: (m.x + m.w) * W - box.x, y2: (m.y + m.h) * H - box.y }));
  const A = pa.data;
  const B = pb.data;
  let changed = 0;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const i = (y * box.width + x) * 4;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) <= 48) continue;
      if (skip.some((m) => x >= m.x1 && x < m.x2 && y >= m.y1 && y < m.y2)) continue;
      if (++changed > 40) return true;
    }
  }
  return false;
}

window.flowdocCapture.onDiff(({ id, a, b, region, masks }) => {
  differ(a, b, region, masks).then(
    (result) => window.flowdocCapture.sendDiff(id, result),
    () => window.flowdocCapture.sendDiff(id, null),
  );
});

// ---------- password fields ----------

// Pixelates password fields into a screenshot, with blocks as tall as the
// field: no character, dot or length survives (recorder.js hideSecrets).
async function pixelateBoxes(dataUrl, boxes) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  for (const f of boxes) {
    const x = Math.max(0, Math.floor(f.x * c.width));
    const y = Math.max(0, Math.floor(f.y * c.height));
    const w = Math.min(c.width - x, Math.ceil(f.w * c.width));
    const h = Math.min(c.height - y, Math.ceil(f.h * c.height));
    if (w <= 0 || h <= 0) continue;
    const block = Math.max(16, h);
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(1, Math.ceil(w / block));
    tiny.height = Math.max(1, Math.ceil(h / block));
    tiny.getContext('2d').drawImage(c, x, y, w, h, 0, 0, tiny.width, tiny.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
  }
  return encode(c);
}

window.flowdocCapture.onRedact(({ id, dataUrl, boxes }) => {
  pixelateBoxes(dataUrl, boxes).then(
    (out) => window.flowdocCapture.sendRedacted(id, out),
    () => window.flowdocCapture.sendRedacted(id, null),
  );
});
