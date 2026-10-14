const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  shortcut: 'CommandOrControl+Shift+V',
  // 'caret': open at the text cursor (falls back to the mouse pointer); 'center': middle of the screen
  position: 'caret',
  maxItems: 300,
  // Copies whose clipboard owner process name contains one of these are never stored.
  ignoredApps: [
    'keepass',
    '1password',
    'bitwarden',
    'lastpass',
    'dashlane',
    'keeper',
    'enpass',
    'roboform',
    'nordpass',
    'protonpass',
    'credentialuibroker',
  ],
};

const MAX_TEXT = 1_000_000;
const MAX_HTML = 300_000;
const LINK_RE = /^(https?:\/\/|www\.)\S+$/i;
const COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([\d\s.,%/-]+\))$/i;

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const squash = (s) => s.toLowerCase().replace(/[\s._-]/g, '');

function kindOf(text) {
  const t = text.trim();
  if (LINK_RE.test(t)) return 'link';
  if (COLOR_RE.test(t)) return 'color';
  return 'text';
}

class Store {
  constructor(dir, onChange) {
    this.dir = dir;
    this.imgDir = path.join(dir, 'images');
    this.historyFile = path.join(dir, 'history.json');
    this.settingsFile = path.join(dir, 'settings.json');
    this.onChange = onChange;
    this.saveTimer = null;
    fs.mkdirSync(this.imgDir, { recursive: true });
    this.settings = this.loadSettings();
    this.items = this.readJson(this.historyFile, []);
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  loadSettings() {
    const saved = this.readJson(this.settingsFile, {});
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    if (JSON.stringify(saved) !== JSON.stringify(settings)) {
      fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
    }
    return settings;
  }

  reloadSettings() {
    this.settings = this.loadSettings();
    this.trim();
  }

  isIgnoredApp(processName) {
    if (!processName) return false;
    const name = squash(processName);
    return this.settings.ignoredApps.some((app) => name.includes(squash(app)));
  }

  // Newest first. Pinning only protects an item from trimming; it doesn't move it.
  list() {
    return [...this.items].sort((a, b) => b.usedAt - a.usedAt);
  }

  get(id) {
    return this.items.find((i) => i.id === id);
  }

  imagePath(file) {
    return path.join(this.imgDir, path.basename(file));
  }

  addText(text, html, source) {
    if (!text.trim() || text.length > MAX_TEXT) return;
    const hash = sha1('t:' + text);
    this.upsert(hash, source, () => ({
      kind: kindOf(text),
      text,
      html: html && html.length <= MAX_HTML ? html : undefined,
    }));
  }

  addImage(image, png, source) {
    const hash = sha1(png);
    this.upsert(hash, source, () => {
      const { width, height } = image.getSize();
      const file = `${hash}.png`;
      const thumb = `${hash}_t.png`;
      fs.writeFileSync(path.join(this.imgDir, file), png);
      const small = width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
      fs.writeFileSync(path.join(this.imgDir, thumb), small.toPNG());
      return { kind: 'image', image: file, thumb, width, height, bytes: png.length };
    });
  }

  upsert(hash, source, make) {
    const now = Date.now();
    const existing = this.items.find((i) => i.hash === hash);
    if (existing) {
      existing.usedAt = now;
      existing.copies = (existing.copies || 1) + 1;
      if (source) existing.source = source;
    } else {
      this.items.push({
        id: crypto.randomUUID(),
        hash,
        source: source || '',
        createdAt: now,
        usedAt: now,
        copies: 1,
        pastes: 0,
        pinned: false,
        ...make(),
      });
      this.trim();
    }
    this.changed();
  }

  markPasted(id) {
    const item = this.get(id);
    if (!item) return;
    item.usedAt = Date.now();
    item.pastes = (item.pastes || 0) + 1;
    this.changed();
  }

  togglePin(id) {
    const item = this.get(id);
    if (!item) return;
    item.pinned = !item.pinned;
    item.pinnedAt = item.pinned ? Date.now() : undefined;
    this.changed();
  }

  remove(id) {
    const item = this.get(id);
    if (!item) return;
    this.items = this.items.filter((i) => i !== item);
    this.deleteFiles(item);
    this.changed();
  }

  clearUnpinned() {
    for (const item of this.items) if (!item.pinned) this.deleteFiles(item);
    this.items = this.items.filter((i) => i.pinned);
    this.changed();
  }

  trim() {
    const unpinned = this.items.filter((i) => !i.pinned).sort((a, b) => b.usedAt - a.usedAt);
    const drop = new Set(unpinned.slice(this.settings.maxItems));
    if (!drop.size) return;
    for (const item of drop) this.deleteFiles(item);
    this.items = this.items.filter((i) => !drop.has(i));
  }

  deleteFiles(item) {
    for (const file of [item.image, item.thumb]) {
      if (file) fs.rm(this.imagePath(file), { force: true }, () => {});
    }
  }

  changed() {
    this.onChange(this.list());
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.saveTimer);
    const tmp = this.historyFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.historyFile);
  }
}

module.exports = { Store };
