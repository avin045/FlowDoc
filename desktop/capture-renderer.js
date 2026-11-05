// Runs inside the hidden capture window (capture.html).
// One <video> per display; grabbing draws the current frame to a canvas.
const streams = new Map(); // displayId -> { video, stream }

window.captureStart = async (sources) => {
  try {
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

const send = (id, c, extra = {}) =>
  window.flowdocCapture.sendFrame(id, { dataUrl: c.toDataURL('image/jpeg', 0.88), width: c.width, height: c.height, ...extra });

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
  const entry = streams.get(displayId) || streams.values().next().value;
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
  held.set(id, { video, c, box, bar: spotPixels(c, box) });
  window.flowdocCapture.sendHeld(id);
});

// The bar is being hidden from captures. Frames already on their way may still
// show it, so wait for one where its spot has changed, and copy that spot in.
// If none comes in time, the bar stays in the shot (and gets blurred).
window.flowdocCapture.onPatch(async ({ id }) => {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  const { video, c, box, bar } = h;
  const end = Date.now() + 800;
  while (Date.now() < end) {
    if (!(await nextFrame(video, end - Date.now()))) break;
    if (meanDiff(spotPixels(video, box), bar) < 24) continue;
    c.getContext('2d').drawImage(video, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    return send(id, c, { barHidden: true });
  }
  send(id, c);
});
