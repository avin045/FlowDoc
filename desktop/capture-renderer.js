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

window.flowdocCapture.onGrab(({ id, displayId }) => {
  const entry = streams.get(displayId) || streams.values().next().value;
  if (!entry || !entry.video.videoWidth) {
    window.flowdocCapture.sendFrame(id, null);
    return;
  }
  const { video } = entry;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  window.flowdocCapture.sendFrame(id, {
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    width: canvas.width,
    height: canvas.height,
  });
});
