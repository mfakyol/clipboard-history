// Shared mock data for the screenshot and demo GIF scripts.
// Produces HTML that opens the built renderer (dist/) with a fake window.clip API.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const RENDERER = path.join(ROOT, 'dist')

const MIN = 60_000
const HOUR = 60 * MIN

// Newest first, like the real store. `ago` is converted to timestamps in the page.
const items = [
  { kind: 'link', text: 'https://github.com/mfakyol/clipboard-history', source: 'chrome', ago: 0.6 * MIN },
  { kind: 'image', width: 1280, height: 720, bytes: 86_000, source: 'snippingtool', ago: 3 * MIN },
  { kind: 'text', text: 'alex.morgan@example.com', source: 'chrome', ago: 7 * MIN },
  {
    kind: 'text',
    text: 'Weekly active users grew 18% after the onboarding redesign.\nThe biggest jump came from the new import flow.',
    source: 'notepad',
    ago: 11 * MIN,
    copies: 2,
  },
  { kind: 'color', text: '#6366f1', source: 'chrome', ago: 26 * MIN },
  { kind: 'text', text: 'npm run dist', source: 'windowsterminal', ago: 48 * MIN, copies: 3 },
  {
    kind: 'text',
    text: 'const debounce = (fn, ms) => {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n};',
    source: 'code',
    ago: 2 * HOUR,
  },
  { kind: 'text', text: 'Tomorrow 10:30, meeting room B', source: 'teams', ago: 5 * HOUR, pinned: true },
  { kind: 'link', text: 'https://fatihakyol.com', source: 'chrome', ago: 26 * HOUR, pastes: 4 },
].map((item, i) => ({
  id: `item-${i}`,
  hash: `h${i}`,
  copies: 1,
  pastes: 0,
  pinned: false,
  ...item,
  ...(item.kind === 'image' ? { image: 'demo.png', thumb: 'demo_t.png' } : {}),
}))

/** Injects a mocked window.clip into the built index.html */
function mockHtml() {
  const index = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8')
  const mock = `
<script>
  const now = Date.now();
  const items = ${JSON.stringify(items)}.map((i) => ({
    ...i, usedAt: now - i.ago, createdAt: now - i.ago * 3, pinnedAt: i.pinned ? now - i.ago : undefined,
  }));
  const listeners = { show: [], search: [] };
  const on = (name) => (cb) => (listeners[name].push(cb), () => {});
  const tell = (msg) => window.parent !== window && window.parent.postMessage(msg, '*');
  window.clip = {
    getHistory: async () => items,
    paste: async (id, opts) => tell({ type: 'paste', item: items.find((i) => i.id === id), plain: !!(opts && opts.plain) }),
    togglePin: async () => {},
    remove: async () => {},
    clear: async () => {},
    hide: () => tell({ type: 'hide' }),
    startSearch: () => listeners.search.forEach((cb) => cb()),
    onHistory: () => () => {},
    onShow: on('show'),
    onPasteSelected: () => () => {},
    onSearchMode: on('search'),
  };
  window.__show = () => listeners.show.forEach((cb) => cb());
</script>`
  // CSP blocks inline scripts; drop it for the mock api
  return index.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace('<head>', '<head>' + mock)
}

/** Writes a page into the renderer folder (for relative asset paths) and returns its path */
function writePage(name, html) {
  const file = path.join(RENDERER, name)
  fs.writeFileSync(file, html, 'utf8')
  return file
}

const writeMockPage = (name) => writePage(name, mockHtml())

module.exports = { ROOT, RENDERER, writePage, writeMockPage }
