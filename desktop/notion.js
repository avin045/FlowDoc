// The Notion client lives with the shared code so the browser extension can use it too.
// FLOWDOC_NOTION_URL points it at a mock server for tests.
import { setNotionBase } from '../extension/shared/notionClient.js';

export * from '../extension/shared/notionClient.js';
if (process.env.FLOWDOC_NOTION_URL) setNotionBase(process.env.FLOWDOC_NOTION_URL);
