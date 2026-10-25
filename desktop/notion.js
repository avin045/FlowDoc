// Notion client for "Save to Notion" (main process only, so the token never
// reaches the page). Uses an internal integration token that each user
// creates in their own workspace. API version 2026-03-11.
// FLOWDOC_NOTION_URL points it at a mock server for tests.

const BASE = () => process.env.FLOWDOC_NOTION_URL || 'https://api.notion.com';
const VERSION = '2026-03-11';
const MAX_TEXT = 2000; // characters per rich-text object
const CHUNK = 90; // blocks per request (Notion allows 100)

async function call(token, method, path, body, { form } = {}) {
  if (!token) throw new Error('Connect Notion first (Settings → Notion).');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE()}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': VERSION,
          ...(form ? {} : { 'content-type': 'application/json' }),
        },
        body: form || (body ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new Error(`Couldn't reach Notion (${err?.cause?.code || err.message}). Check your internet connection.`);
    }
    // Notion allows about 3 requests a second; wait as told and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 20_000)));
      continue;
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const hint =
        res.status === 401
          ? ' The token is invalid or was revoked; paste it again in Settings → Notion.'
          : res.status === 404 || data.code === 'object_not_found'
            ? ' Make sure the page is shared with your integration (in Notion: ••• → Connections).'
            : '';
      const err = new Error(`Notion ${res.status}: ${data.message || res.statusText}.${hint}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

const plainTitle = (page) => {
  const prop = Object.values(page.properties || {}).find((p) => p?.type === 'title');
  return (prop?.title || []).map((t) => t.plain_text || t.text?.content || '').join('').trim() || 'Untitled';
};

export async function whoAmI(token) {
  const me = await call(token, 'GET', '/v1/users/me');
  return { workspace: me.bot?.workspace_name || '', name: me.name || 'Integration' };
}

// Pages the integration can see, newest first (optionally only titles that
// contain `query`), with their parent page. Notion's search doesn't reliably
// return every subpage, so the picker uses this for the top level and for
// searching, and listChildPages() to browse down. Database rows are skipped.
export async function listPages(token, query = '') {
  const pages = [];
  let cursor;
  do {
    const data = await call(token, 'POST', '/v1/search', {
      ...(query ? { query } : {}),
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of data.results || []) {
      if (p.in_trash || p.is_archived) continue;
      const parentType = p.parent?.type;
      if (parentType === 'database_id' || parentType === 'data_source_id') continue;
      pages.push({
        id: p.id,
        title: plainTitle(p),
        parentId: parentType === 'page_id' ? p.parent.page_id : null,
        icon: p.icon?.type === 'emoji' ? p.icon.emoji : '',
        url: p.url,
      });
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && pages.length < 1000);
  return pages;
}

async function childBlocks(token, blockId) {
  const blocks = [];
  let cursor;
  do {
    const data = await call(token, 'GET', `/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && blocks.length < 2000);
  return blocks;
}

// Blocks that can hold a subpage inside them (a page placed in a column or a
// toggle is still a subpage of the page).
const CONTAINERS = new Set(['column_list', 'column', 'toggle', 'synced_block', 'tab', 'callout', 'quote', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item']);

/** The subpages directly inside a page, in the order they appear. */
export async function listChildPages(token, pageId) {
  const pages = [];
  const walk = async (blockId, depth) => {
    for (const b of await childBlocks(token, blockId)) {
      if (b.in_trash || b.archived) continue;
      if (b.type === 'child_page') pages.push({ id: b.id, title: b.child_page?.title?.trim() || 'Untitled' });
      else if (b.has_children && depth < 3 && CONTAINERS.has(b.type)) await walk(b.id, depth + 1);
    }
  };
  await walk(pageId, 0);
  return pages;
}

/**
 * The chain of pages from the top of the workspace down to pageId, as
 * [{ id, title }]. Stops early at a parent the integration can't see.
 */
export async function pathTo(token, pageId) {
  const crumbs = [];
  let kind = 'page';
  let id = pageId;
  const next = (parent) => {
    if (parent?.type === 'page_id') return ['page', parent.page_id];
    if (parent?.type === 'block_id') return ['block', parent.block_id];
    return [null, null];
  };
  for (let i = 0; i < 20 && id; i++) {
    try {
      if (kind === 'page') {
        const page = await call(token, 'GET', `/v1/pages/${id}`);
        crumbs.unshift({ id: page.id, title: plainTitle(page) });
        [kind, id] = next(page.parent);
      } else {
        const block = await call(token, 'GET', `/v1/blocks/${id}`);
        [kind, id] = next(block.parent);
      }
    } catch (err) {
      if (!crumbs.length) throw err;
      break; // a parent that isn't shared with the integration
    }
  }
  return crumbs;
}

// ---------- page content ----------

function richText(runs = [], extra = {}) {
  const out = [];
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i += MAX_TEXT) {
      const content = r.text.slice(i, i + MAX_TEXT);
      out.push({
        type: 'text',
        text: { content, ...(r.link ? { link: { url: r.link } } : {}) },
        annotations: { bold: !!r.bold, italic: !!extra.italic, color: extra.color || 'default' },
      });
    }
  }
  return out;
}
const para = (runs, extra) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(runs, extra) } });

function blocksFor(model, uploads) {
  const blocks = [];
  if (model.description) blocks.push(para([{ text: model.description }]));
  blocks.push(para([{ text: `${model.stepCount} steps · created with FlowDoc` }], { italic: true, color: 'gray' }));
  blocks.push({ object: 'block', type: 'divider', divider: {} });
  for (const b of model.blocks) {
    if (b.kind === 'heading') {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText([{ text: b.text }]) } });
    } else if (b.kind === 'tip' || b.kind === 'alert') {
      const tip = b.kind === 'tip';
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: { rich_text: richText(b.runs), icon: { type: 'emoji', emoji: tip ? '💡' : '⚠️' }, color: tip ? 'blue_background' : 'orange_background' },
      });
    } else if (b.kind === 'text') {
      blocks.push(para(b.runs));
    } else {
      // Steps are numbered explicitly: Notion restarts numbered lists after every
      // heading or callout, which would break the guide's numbering.
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [...richText([{ text: `${b.number}. ` }], { color: 'blue' }), ...richText(b.runs)] },
      });
      if (b.noteRuns?.length) blocks.push(para(b.noteRuns, { color: 'gray' }));
      if (b.url) blocks.push(para([{ text: b.url, link: b.url }], { color: 'gray' }));
      const upload = uploads.get(b.number);
      if (upload) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: { type: 'file_upload', file_upload: { id: upload } },
        });
      }
    }
  }
  return blocks;
}

async function uploadImage(token, dataUrl, name) {
  const created = await call(token, 'POST', '/v1/file_uploads', { filename: name, content_type: 'image/jpeg' });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), name);
  await call(token, 'POST', `/v1/file_uploads/${created.id}/send`, null, { form });
  return created.id;
}

/**
 * Creates the guide as a new page under parentId.
 * @param model  export model from the workspace: blocks carry `runs`/`noteRuns`
 *               (bold/plain text pieces) and optional image data URLs.
 * @param onProgress ({ phase, done, total })
 * @returns {{ id: string, url: string }}
 */
export async function saveGuide(token, { parentId, title, model, replacePageId }, onProgress = () => {}) {
  // 1. Screenshots, two at a time.
  const images = model.blocks.filter((b) => b.image?.dataUrl);
  const uploads = new Map();
  let done = 0;
  onProgress({ phase: 'images', done, total: images.length });
  let next = 0;
  const worker = async () => {
    while (next < images.length) {
      const b = images[next++];
      uploads.set(b.number, await uploadImage(token, b.image.dataUrl, `step-${String(b.number).padStart(2, '0')}.jpg`));
      onProgress({ phase: 'images', done: ++done, total: images.length });
    }
  };
  await Promise.all([worker(), worker()]);

  // 2. The page with its first blocks, then the rest in chunks.
  const blocks = blocksFor(model, uploads);
  onProgress({ phase: 'blocks', done: 0, total: blocks.length });
  const page = await call(token, 'POST', '/v1/pages', {
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: '📘' },
    properties: { title: { title: richText([{ text: title || model.title }]) } },
    children: blocks.slice(0, CHUNK),
  });
  for (let i = CHUNK; i < blocks.length; i += CHUNK) {
    await call(token, 'PATCH', `/v1/blocks/${page.id}/children`, { children: blocks.slice(i, i + CHUNK) });
    onProgress({ phase: 'blocks', done: Math.min(i + CHUNK, blocks.length), total: blocks.length });
  }
  onProgress({ phase: 'blocks', done: blocks.length, total: blocks.length });

  // 3. Optionally move the copy saved last time to Notion's trash.
  if (replacePageId && replacePageId !== page.id) {
    try {
      await call(token, 'PATCH', `/v1/pages/${replacePageId}`, { in_trash: true });
    } catch {
      /* already deleted or no longer shared: nothing to replace */
    }
  }
  return { id: page.id, url: page.url };
}
