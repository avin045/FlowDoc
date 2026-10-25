// Builds a sample guide with drawn screenshots so the workspace can be tried
// without recording anything (and so the web build has something to show).
import { createGuide } from '../shared/guides.js';

const W = 1280;
const H = 720;

function frame(draw) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, W, H);
  // app header
  ctx.fillStyle = '#0f766e';
  ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('Acme Projects', 32, 40);
  ctx.font = '15px system-ui, sans-serif';
  ['Dashboard', 'Projects', 'Team', 'Settings'].forEach((t, i) => ctx.fillText(t, 760 + i * 120, 39));
  draw(ctx);
  return c.toDataURL('image/jpeg', 0.9);
}

function field(ctx, x, y, w, label, value, focused) {
  ctx.fillStyle = '#334155';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(label, x, y - 10);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = focused ? '#0f766e' : '#cbd5e1';
  ctx.lineWidth = focused ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 44, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = value ? '#0f172a' : '#94a3b8';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(value || 'you@company.com', x + 14, y + 28);
}

function button(ctx, x, y, w, label, color = '#0f766e') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 46, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '600 16px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillText(label, x + (w - tw) / 2, y + 29);
}

function card(ctx, x, y, w, h) {
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(15,23,42,.12)';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function loginScreen(email, password) {
  return frame((ctx) => {
    card(ctx, 440, 120, 400, 440);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText('Sign in', 476, 180);
    field(ctx, 476, 240, 328, 'Email', email, !!email && !password);
    ctx.fillStyle = '#334155';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText('Password', 476, 314);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = password ? '#0f766e' : '#cbd5e1';
    ctx.beginPath();
    ctx.roundRect(476, 324, 328, 44, 8);
    ctx.fill();
    ctx.stroke();
    if (password) {
      ctx.fillStyle = '#0f172a';
      ctx.fillText('••••••••••', 490, 352);
    }
    button(ctx, 476, 420, 328, 'Sign in');
  });
}

function dashboard(withMenu) {
  return frame((ctx) => {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('Your projects', 64, 130);
    button(ctx, 1040, 96, 176, '+ New project');
    ['Website redesign', 'Q3 onboarding', 'Mobile app'].forEach((t, i) => {
      card(ctx, 64 + i * 390, 180, 360, 160);
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(t, 92 + i * 390, 224);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(`${4 + i * 3} open tasks · updated today`, 92 + i * 390, 254);
    });
    if (withMenu) {
      card(ctx, 380, 150, 520, 400);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText('Create a project', 416, 200);
      field(ctx, 416, 250, 448, 'Project name', 'Customer portal', false);
      ctx.fillStyle = '#334155';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText('Template', 416, 330);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.roundRect(416, 340, 448, 44, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText('Kanban board', 430, 368);
      button(ctx, 704, 470, 160, 'Create');
    }
  });
}

const shot = { width: W, height: H, viewportW: W, viewportH: H };

export function makeSampleGuide() {
  const url = 'https://projects.acme.example/login';
  const step = (fields) => ({
    id: crypto.randomUUID(),
    kind: 'action',
    highlight: true,
    redactions: [],
    crop: null,
    url,
    shot,
    createdAt: Date.now(),
    ...fields,
  });
  return createGuide({
    title: 'How to create a new project in Acme Projects',
    description: 'Sign in to Acme Projects and set up a new project from a template.',
    source: { url, title: 'Acme Projects' },
    steps: [
      step({ action: 'navigate', text: 'Navigate to **projects.acme.example**', href: url, screenshot: loginScreen('', false) }),
      step({ action: 'click', text: 'Click the **Email** field', screenshot: loginScreen('', false), target: { x: 476, y: 240, w: 328, h: 44 }, click: { x: 560, y: 262 } }),
      step({ action: 'type', text: 'Type "jordan@acme.example" in the **Email** field', screenshot: loginScreen('jordan@acme.example', false), target: { x: 476, y: 240, w: 328, h: 44 } }),
      step({ action: 'type', text: 'Type your password in the **Password** field', screenshot: loginScreen('jordan@acme.example', true), target: { x: 476, y: 324, w: 328, h: 44 } }),
      step({ action: 'click', text: 'Click **Sign in**', screenshot: loginScreen('jordan@acme.example', true), target: { x: 476, y: 420, w: 328, h: 46 }, click: { x: 640, y: 443 } }),
      { id: crypto.randomUUID(), kind: 'tip', text: 'Use your company SSO account if your team has single sign-on enabled.' },
      { id: crypto.randomUUID(), kind: 'heading', text: 'Create the project' },
      step({ action: 'click', text: 'Click **+ New project**', url: 'https://projects.acme.example/dashboard', screenshot: dashboard(false), target: { x: 1040, y: 96, w: 176, h: 46 }, click: { x: 1128, y: 119 } }),
      step({ action: 'select', text: 'Select **Kanban board** from **Template**', url: 'https://projects.acme.example/dashboard', screenshot: dashboard(true), target: { x: 416, y: 340, w: 448, h: 44 } }),
      step({ action: 'click', text: 'Click **Create**', url: 'https://projects.acme.example/dashboard', screenshot: dashboard(true), target: { x: 704, y: 470, w: 160, h: 46 }, click: { x: 784, y: 493 } }),
      { id: crypto.randomUUID(), kind: 'alert', text: 'Project names are visible to everyone in your workspace.' },
    ],
  });
}
