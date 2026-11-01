// Area picker overlay for one display. Coordinates are CSS pixels relative to
// the display, which are the display's DIPs.
const $ = (id) => document.getElementById(id);
const MIN = 24;
let size = { width: innerWidth, height: innerHeight };
let windows = []; // other apps' windows on this display, front to back
let sel = null; // { x, y, width, height }
let drag = null;

const clampRect = (r) => {
  const x = Math.max(0, Math.min(r.x, size.width - MIN));
  const y = Math.max(0, Math.min(r.y, size.height - MIN));
  return { x, y, width: Math.max(MIN, Math.min(r.width, size.width - x)), height: Math.max(MIN, Math.min(r.height, size.height - y)) };
};
const place = (el, r) => Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
const windowAt = (x, y) => windows.find((w) => x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height);

function render() {
  document.body.classList.toggle('has-sel', !!sel);
  if (!sel) return;
  place($('sel'), sel);
  $('size').textContent = `${Math.round(sel.width)} × ${Math.round(sel.height)}`;
  $('size').style.top = sel.y < 30 ? '6px' : '-26px';
  $('size').style.left = sel.y < 30 ? '6px' : '0';
  // Start/Cancel below the area, or above it, or inside its bottom edge.
  const bar = $('bar');
  const bw = bar.offsetWidth || 260;
  const bh = bar.offsetHeight || 44;
  const left = Math.max(8, Math.min(sel.x + sel.width - bw, size.width - bw - 8));
  let top = sel.y + sel.height + 10;
  if (top + bh > size.height - 8) top = sel.y - bh - 10;
  if (top < 8) top = sel.y + sel.height - bh - 10;
  Object.assign(bar.style, { left: `${left}px`, top: `${top}px` });
}

function setHover(x, y) {
  const w = !sel && !drag ? windowAt(x, y) : null;
  document.body.classList.toggle('hovering', !!w);
  if (w) place($('hover'), clampRect(w));
}

function done() {
  if (sel) areaPicker.done({ x: Math.round(sel.x), y: Math.round(sel.y), width: Math.round(sel.width), height: Math.round(sel.height) });
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('#bar')) return;
  const handle = e.target.closest('.handle');
  const inside = e.target.closest('#sel');
  document.body.setPointerCapture?.(e.pointerId);
  if (handle) drag = { kind: 'resize', dir: handle.dataset.dir, start: { x: e.clientX, y: e.clientY }, from: { ...sel } };
  else if (inside) drag = { kind: 'move', start: { x: e.clientX, y: e.clientY }, from: { ...sel } };
  else drag = { kind: 'new', start: { x: e.clientX, y: e.clientY }, moved: false };
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return setHover(e.clientX, e.clientY);
  const dx = e.clientX - drag.start.x;
  const dy = e.clientY - drag.start.y;
  if (drag.kind === 'new') {
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      areaPicker.began();
      document.body.classList.remove('hovering');
    }
    const x = Math.min(drag.start.x, e.clientX);
    const y = Math.min(drag.start.y, e.clientY);
    sel = clampRect({ x, y, width: Math.abs(dx), height: Math.abs(dy) });
  } else if (drag.kind === 'move') {
    const f = drag.from;
    sel = { ...f, x: Math.max(0, Math.min(f.x + dx, size.width - f.width)), y: Math.max(0, Math.min(f.y + dy, size.height - f.height)) };
  } else {
    const f = drag.from;
    let { x, y } = f;
    let right = f.x + f.width;
    let bottom = f.y + f.height;
    if (drag.dir.includes('w')) x = Math.min(f.x + dx, right - MIN);
    if (drag.dir.includes('e')) right = Math.max(right + dx, x + MIN);
    if (drag.dir.includes('n')) y = Math.min(f.y + dy, bottom - MIN);
    if (drag.dir.includes('s')) bottom = Math.max(bottom + dy, y + MIN);
    sel = clampRect({ x, y, width: right - x, height: bottom - y });
  }
  document.body.classList.add('dragging');
  render();
});

document.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging');
  if (d?.kind === 'new' && !d.moved) {
    // A plain click takes the window under the pointer.
    const w = windowAt(e.clientX, e.clientY);
    if (w) {
      areaPicker.began();
      sel = clampRect(w);
    }
  }
  setHover(e.clientX, e.clientY);
  render();
});

document.addEventListener('dblclick', (e) => {
  if (sel && e.target.closest('#sel')) done();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') areaPicker.cancel();
  else if (e.key === 'Enter') done();
});
$('start').addEventListener('click', done);
$('cancel').addEventListener('click', () => areaPicker.cancel());

areaPicker.onInit((data) => {
  size = { width: data.width, height: data.height };
  windows = data.windows || [];
  sel = data.initial ? clampRect(data.initial) : null;
  render();
});
areaPicker.onClear(() => {
  sel = null;
  render();
});
