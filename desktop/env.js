// Switches for the test suites, read from environment variables
// (scripts/desktop-test.mjs). They point AI and Notion requests at mock
// servers, run the self-test, and so on. A normal launch ignores them all:
// they only count in a separate data folder (FLOWDOC_USER_DATA), where none
// of the user's guides or keys are, and the mock servers must be on this
// computer. Otherwise anything able to set them could send the user's API
// keys elsewhere, or run the self-test against their real data.
//
// Imported first by main.js, before the modules that read them.
const env = process.env;
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
const TEST_ONLY = ['FLOWDOC_SELFTEST', 'FLOWDOC_LEGACY_DIR', 'FLOWDOC_NO_HOOK', 'FLOWDOC_TEST_OUT', 'FLOWDOC_AI_TIMEOUT_MS'];
const MOCK_URLS = ['FLOWDOC_GEMINI_URL', 'FLOWDOC_GROQ_URL', 'FLOWDOC_NOTION_URL'];

const isolated = !!env.FLOWDOC_USER_DATA;
for (const name of [...TEST_ONLY, ...MOCK_URLS]) {
  if (!(name in env)) continue;
  const keep = isolated && (!MOCK_URLS.includes(name) || LOCAL_URL.test(env[name]));
  if (!keep) {
    console.warn(`[FlowDoc] ignoring ${name}: test settings apply only with FLOWDOC_USER_DATA${MOCK_URLS.includes(name) ? ' and a localhost URL' : ''}`);
    delete env[name];
  }
}
