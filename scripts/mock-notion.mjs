// A stand-in for the Notion API, shared by the desktop test (through a local
// server) and the extension test (through Playwright request routing).
// Team wiki › How-tos › AWS Trial › (toggle) › some_topic › some_topic_2, and
// Team wiki › (columns) › Archive.

const NPAGES = {
  'p-wiki': { title: 'Team wiki', parent: { type: 'workspace', workspace: true }, icon: '📚' },
  'p-howtos': { title: 'How-tos', parent: { type: 'page_id', page_id: 'p-wiki' } },
  'p-archive': { title: 'Archive', parent: { type: 'block_id', block_id: 'b-col1' } },
  'p-aws': { title: 'AWS Trial', parent: { type: 'page_id', page_id: 'p-howtos' } },
  'p-topic': { title: 'some_topic', parent: { type: 'block_id', block_id: 'b-toggle' } },
  'p-topic2': { title: 'some_topic_2', parent: { type: 'page_id', page_id: 'p-topic' } },
};
const NBLOCKS = {
  'b-cols': { type: 'column_list', parent: { type: 'page_id', page_id: 'p-wiki' } },
  'b-col1': { type: 'column', parent: { type: 'block_id', block_id: 'b-cols' } },
  'b-toggle': { type: 'toggle', parent: { type: 'page_id', page_id: 'p-aws' } },
};
const childPage = (id) => ({ object: 'block', id, type: 'child_page', has_children: false, child_page: { title: NPAGES[id].title } });
const container = (id) => ({ object: 'block', id, type: NBLOCKS[id].type, has_children: true, [NBLOCKS[id].type]: {} });
const NCHILDREN = {
  'p-wiki': [childPage('p-howtos'), container('b-cols')],
  'b-cols': [container('b-col1')],
  'b-col1': [childPage('p-archive')],
  'p-howtos': [childPage('p-aws'), { object: 'block', id: 'b-para', type: 'paragraph', has_children: false, paragraph: {} }],
  'p-aws': [container('b-toggle')],
  'b-toggle': [childPage('p-topic')],
  'p-topic': [childPage('p-topic2')],
};
const pageObject = (id) => ({ object: 'page', id, url: `https://www.notion.so/${id}`, parent: NPAGES[id].parent, properties: { title: { type: 'title', title: [{ plain_text: NPAGES[id].title }] } }, ...(NPAGES[id].icon ? { icon: { type: 'emoji', emoji: NPAGES[id].icon } } : {}) });

export function createNotionMock() {
  // What the app sent, for the checks.
  const notion = { calls: [], uploads: 0, sent: [], pages: [], appends: [], trashed: [] };
  function handle({ method, url, headers = {}, body }) {
    const json = body && !headers['content-type']?.startsWith('multipart') ? JSON.parse(String(body)) : {};
    notion.calls.push({ method, url, version: headers['notion-version'], auth: headers.authorization });
    const send = (data, status = 200) => ({ status, data });
    if (url === '/v1/users/me') return send({ object: 'user', name: 'FlowDoc', bot: { workspace_name: 'Avinash Workspace' } });
    if (url === '/v1/search') {
      const q = (json.query || '').toLowerCase();
      const ids = q ? Object.keys(NPAGES).filter((id) => NPAGES[id].title.toLowerCase().includes(q)) : ['p-wiki'];
      const results = ids.map(pageObject);
      if (!q) results.push({ object: 'page', id: 'p-row', url: 'https://www.notion.so/p-row', parent: { type: 'data_source_id', data_source_id: 'ds1' }, properties: { Name: { type: 'title', title: [{ plain_text: 'A database row' }] } } });
      return send({ object: 'list', has_more: false, next_cursor: null, results });
    }
    const childrenMatch = url.match(/^\/v1\/blocks\/([\w-]+)\/children(\?.*)?$/);
    if (childrenMatch && method === 'GET') return send({ object: 'list', has_more: false, next_cursor: null, results: NCHILDREN[childrenMatch[1]] || [] });
    const getPage = url.match(/^\/v1\/pages\/([\w-]+)$/);
    if (getPage && method === 'GET' && NPAGES[getPage[1]]) return send(pageObject(getPage[1]));
    const getBlock = url.match(/^\/v1\/blocks\/([\w-]+)$/);
    if (getBlock && method === 'GET' && NBLOCKS[getBlock[1]]) return send({ object: 'block', id: getBlock[1], type: NBLOCKS[getBlock[1]].type, parent: NBLOCKS[getBlock[1]].parent });
    if (url === '/v1/file_uploads' && method === 'POST') {
      notion.uploads++;
      return send({ object: 'file_upload', id: `fu-${notion.uploads}`, status: 'pending', filename: json.filename, content_type: json.content_type });
    }
    const sendMatch = url.match(/^\/v1\/file_uploads\/(fu-\d+)\/send$/);
    if (sendMatch) {
      notion.sent.push({ id: sendMatch[1], multipart: (headers['content-type'] || '').startsWith('multipart/form-data'), bytes: body.length });
      return send({ object: 'file_upload', id: sendMatch[1], status: 'uploaded' });
    }
    if (url === '/v1/pages' && method === 'POST') {
      notion.pages.push(json);
      const id = notion.pages.length === 1 ? 'page-new' : `page-new-${notion.pages.length}`;
      return send({ object: 'page', id, url: `https://www.notion.so/${id}` });
    }
    const appendMatch = url.match(/^\/v1\/blocks\/([\w-]+)\/children$/);
    if (appendMatch && method === 'PATCH') {
      notion.appends.push(json.children.length);
      return send({ object: 'list', results: [] });
    }
    const pageMatch = url.match(/^\/v1\/pages\/([\w-]+)$/);
    if (pageMatch && method === 'PATCH') {
      notion.trashed.push(pageMatch[1]);
      return send({ object: 'page', id: pageMatch[1], in_trash: true });
    }
    return send({ object: 'error', status: 404, code: 'object_not_found', message: 'Not found' }, 404);
  }
  return { notion, handle };
}
