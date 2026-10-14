import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../electron/store.cjs';

// Each test gets a fresh data folder; the store's 300ms save debounce runs on fake timers.
let dir;
let changes;

const makeStore = (settings) => {
  if (settings) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  return new Store(dir, (items) => changes.push(items));
};

// Stand-in for Electron's nativeImage: just the methods the store calls.
const fakeImage = (width, height) => ({
  getSize: () => ({ width, height }),
  resize: ({ width: w }) => fakeImage(w, Math.round((height * w) / width)),
  toPNG: () => Buffer.from(`thumb-${width}x${height}`),
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-store-'));
  changes = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms);

describe('adding text', () => {
  it('detects links, colors and plain text', () => {
    const store = makeStore();
    for (const t of ['https://fatihakyol.com', 'www.example.com/a?b=1', '#6366f1', 'rgb(10, 20, 30)', 'hello world'])
      store.addText(t, undefined, 'chrome'), tick();
    const kinds = Object.fromEntries(store.list().map((i) => [i.text, i.kind]));
    expect(kinds).toEqual({
      'https://fatihakyol.com': 'link',
      'www.example.com/a?b=1': 'link',
      '#6366f1': 'color',
      'rgb(10, 20, 30)': 'color',
      'hello world': 'text',
    });
  });

  it('ignores blank and oversized text', () => {
    const store = makeStore();
    store.addText('   \n\t ', undefined, 'x');
    store.addText('a'.repeat(1_000_001), undefined, 'x');
    expect(store.list()).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('keeps HTML for rich text, but not when it is huge', () => {
    const store = makeStore();
    store.addText('bold', '<b>bold</b>', 'word');
    store.addText('big', '<p>' + 'x'.repeat(300_001) + '</p>', 'word');
    const byText = Object.fromEntries(store.list().map((i) => [i.text, i.html]));
    expect(byText.bold).toBe('<b>bold</b>');
    expect(byText.big).toBeUndefined();
  });

  it('merges a repeated copy into one item and moves it to the top', () => {
    const store = makeStore();
    store.addText('first', undefined, 'notepad');
    tick();
    store.addText('second', undefined, 'notepad');
    tick();
    store.addText('first', undefined, 'code');
    const list = store.list();
    expect(list.map((i) => i.text)).toEqual(['first', 'second']);
    expect(list[0]).toMatchObject({ copies: 2, source: 'code' });
  });

  it('reports every change with the current list', () => {
    const store = makeStore();
    store.addText('a', undefined, 'x');
    store.addText('b', undefined, 'x');
    expect(changes).toHaveLength(2);
    expect(changes[1]).toHaveLength(2);
  });
});

describe('ordering', () => {
  it('lists newest first, and pinning does not move an item', () => {
    const store = makeStore();
    store.addText('old', undefined, 'x');
    tick();
    store.addText('new', undefined, 'x');
    store.togglePin(store.list().find((i) => i.text === 'old').id);
    expect(store.list().map((i) => i.text)).toEqual(['new', 'old']);
  });

  it('moves a pasted item to the top and counts the paste', () => {
    const store = makeStore();
    store.addText('a', undefined, 'x');
    tick();
    store.addText('b', undefined, 'x');
    tick();
    const a = store.list().find((i) => i.text === 'a');
    store.markPasted(a.id);
    expect(store.list()[0]).toMatchObject({ text: 'a', pastes: 1 });
  });
});

describe('limits and pinning', () => {
  it('drops the oldest unpinned items beyond maxItems but always keeps pinned ones', () => {
    const store = makeStore({ maxItems: 2 });
    store.addText('pinned', undefined, 'x');
    store.togglePin(store.list()[0].id);
    for (const t of ['one', 'two', 'three']) tick(), store.addText(t, undefined, 'x');
    expect(store.list().map((i) => i.text).sort()).toEqual(['pinned', 'three', 'two']);
  });

  it('clears everything except pinned items', () => {
    const store = makeStore();
    store.addText('keep', undefined, 'x');
    store.addText('drop', undefined, 'x');
    store.togglePin(store.list().find((i) => i.text === 'keep').id);
    store.clearUnpinned();
    expect(store.list().map((i) => i.text)).toEqual(['keep']);
  });

  it('records when an item was pinned and forgets it when unpinned', () => {
    const store = makeStore();
    store.addText('a', undefined, 'x');
    const { id } = store.list()[0];
    store.togglePin(id);
    expect(store.get(id)).toMatchObject({ pinned: true, pinnedAt: Date.now() });
    store.togglePin(id);
    expect(store.get(id)).toMatchObject({ pinned: false, pinnedAt: undefined });
  });

  it('removes a single item', () => {
    const store = makeStore();
    store.addText('a', undefined, 'x');
    store.remove(store.list()[0].id);
    expect(store.list()).toEqual([]);
  });
});

describe('password managers', () => {
  it.each(['KeePassXC', 'KeePass', '1Password', '1Password 7', 'Bitwarden', 'Proton Pass', 'CredentialUIBroker'])(
    'ignores copies from %s',
    (app) => {
      expect(makeStore().isIgnoredApp(app)).toBe(true);
    }
  );

  it.each(['chrome', 'Code', 'notepad', 'WINWORD', '', undefined])('records copies from %j', (app) => {
    expect(makeStore().isIgnoredApp(app)).toBe(false);
  });

  it('honours an ignore list edited in settings.json', () => {
    const store = makeStore({ ignoredApps: ['slack'] });
    expect(store.isIgnoredApp('Slack')).toBe(true);
    expect(store.isIgnoredApp('KeePass')).toBe(false);
  });
});

describe('settings', () => {
  it('fills in missing defaults and writes them back, keeping user values', () => {
    makeStore({ maxItems: 50 });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(saved.maxItems).toBe(50);
    expect(saved.shortcut).toBe('CommandOrControl+Shift+V');
    expect(saved.ignoredApps).toContain('keepass');
  });

  it('falls back to defaults when settings.json is broken', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    expect(new Store(dir, () => {}).settings.maxItems).toBe(300);
  });
});

describe('persistence', () => {
  it('saves after the debounce and loads the same history back', () => {
    const store = makeStore();
    store.addText('remember me', undefined, 'x');
    expect(fs.existsSync(path.join(dir, 'history.json'))).toBe(false);
    vi.advanceTimersByTime(300);
    const reloaded = new Store(dir, () => {});
    expect(reloaded.list().map((i) => i.text)).toEqual(['remember me']);
  });

  it('writes atomically and leaves no temp file behind', () => {
    const store = makeStore();
    store.addText('a', undefined, 'x');
    store.flush();
    expect(fs.readdirSync(dir).sort()).toEqual(['history.json', 'images', 'settings.json']);
  });

  it('starts empty when history.json is corrupted', () => {
    fs.writeFileSync(path.join(dir, 'history.json'), '[{ broken');
    expect(makeStore().list()).toEqual([]);
  });
});

describe('images', () => {
  it('stores the PNG and a 480px-wide thumbnail', () => {
    const store = makeStore();
    store.addImage(fakeImage(1920, 1080), Buffer.from('png-bytes'), 'SnippingTool');
    const [item] = store.list();
    expect(item).toMatchObject({ kind: 'image', width: 1920, height: 1080, bytes: 9 });
    expect(fs.readFileSync(store.imagePath(item.image), 'utf8')).toBe('png-bytes');
    expect(fs.readFileSync(store.imagePath(item.thumb), 'utf8')).toBe('thumb-480x270');
  });

  it('merges the same screenshot copied twice', () => {
    const store = makeStore();
    store.addImage(fakeImage(100, 100), Buffer.from('same'), 'x');
    store.addImage(fakeImage(100, 100), Buffer.from('same'), 'x');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].copies).toBe(2);
  });

  it('never resolves an image path outside its folder', () => {
    const store = makeStore();
    expect(path.dirname(store.imagePath('../../etc/passwd'))).toBe(path.join(dir, 'images'));
  });
});
