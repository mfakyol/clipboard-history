// The demo GIF's backdrop: a fake notes editor with the real palette (built renderer + mock api)
// in an iframe. Mirrors the app's behaviour: the palette opens under the text caret and pastes
// where the caret is, while the editor keeps its focus ring and caret.
const SCENE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; }
body {
  font: 14px/1.5 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  background: radial-gradient(1200px 700px at 20% 0%, #312e81 0%, #111827 55%, #0b1020 100%);
  color: #e5e7eb;
}
.editor {
  position: absolute; left: 70px; top: 40px; width: 1040px; height: 820px;
  background: #1c1d26; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column;
}
.titlebar { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 14px; background: #16171f; color: #9ca3af; font-size: 12.5px; }
.titlebar .dots { display: flex; gap: 6px; margin-left: auto; }
.titlebar .dots span { width: 12px; height: 2px; background: #6b7280; }
.titlebar .app { width: 16px; height: 16px; border-radius: 4px; background: #f59e0b; }
.toolbar { display: flex; gap: 4px; padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.toolbar span { min-width: 28px; height: 26px; padding: 0 8px; display: grid; place-items: center; border-radius: 6px; color: #9ca3af; font-size: 12.5px; }
.toolbar span:first-child { background: rgba(255,255,255,0.06); color: #e5e7eb; }
.toolbar .sep { width: 1px; min-width: 1px; padding: 0; background: rgba(255,255,255,0.08); margin: 4px 6px; }
.doc { flex: 1; padding: 34px 90px; overflow: hidden; }
.doc h1 { font-size: 28px; margin: 0 0 6px; color: #f9fafb; font-weight: 650; }
.doc .sub { color: #6b7280; font-size: 12.5px; margin-bottom: 22px; }
.doc p { margin: 0 0 12px; font-size: 15px; color: #d1d5db; }
.doc a { color: #818cf8; text-decoration: underline; text-underline-offset: 3px; }
.doc img { display: block; width: 400px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); margin: 4px 0 14px; }
.doc pre { margin: 0 0 12px; padding: 12px 14px; background: #111219; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; font: 13px/1.55 'Cascadia Code', Consolas, monospace; font-variant-ligatures: none; color: #c7d2fe; }
.caret { display: inline-block; width: 2px; height: 1.2em; background: #f9fafb; vertical-align: text-bottom; margin-left: 1px; }
.keys {
  position: absolute; left: 100px; bottom: 44px;
  display: none; gap: 6px; align-items: center; padding: 8px 14px; border-radius: 12px;
  background: rgba(17,24,39,0.92); border: 1px solid rgba(255,255,255,0.12); color: #e5e7eb; font-size: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4); z-index: 50;
}
.keys kbd { font: 600 13px 'Segoe UI', sans-serif; padding: 4px 9px; border-radius: 6px; background: rgba(255,255,255,0.1); border-bottom: 2px solid rgba(255,255,255,0.18); }
iframe { position: absolute; border: 0; width: 820px; height: 540px; display: none; z-index: 40; background: transparent; }
`

const SCENE_JS = `
const doc = document.querySelector('.doc');
const frame = document.querySelector('iframe');
const keys = document.querySelector('.keys');
const W = 1180, H = 900, PAD = 16, GAP = 6;

function caretEl() {
  let c = doc.querySelector('.caret');
  if (!c) { c = document.createElement('span'); c.className = 'caret'; }
  return c;
}
// Put the caret at the end of the last paragraph (a new empty one if asked)
window.__newLine = () => {
  if (!caretParagraph().textContent.trim()) return true; // already on an empty line
  const p = document.createElement('p');
  p.appendChild(caretEl());
  doc.appendChild(p);
  return true;
};
function caretParagraph() { return caretEl().parentElement; }

window.__keys = (show) => { keys.style.display = show ? 'flex' : 'none'; return true; };

// Same placement rule as the app: under the caret, left edge aligned; open upwards if no room.
window.__open = () => {
  const r = caretEl().getBoundingClientRect();
  let x = r.left - PAD, y = r.bottom + GAP - PAD;
  if (y + 540 > H) y = r.top - GAP - 540 + PAD;
  x = Math.min(Math.max(x, 0), W - 820);
  y = Math.min(Math.max(y, 0), H - 540);
  frame.style.left = x + 'px';
  frame.style.top = y + 'px';
  frame.contentWindow.__show();
  frame.style.display = 'block';
  return true;
};

window.addEventListener('message', ({ data }) => {
  if (data.type === 'hide') frame.style.display = 'none';
  if (data.type !== 'paste') return;
  frame.style.display = 'none';
  const { item } = data;
  const p = caretParagraph();
  const caret = caretEl();
  if (item.kind === 'image') {
    const img = document.createElement('img');
    img.src = 'clipimg://img/' + item.image;
    p.before(img);
    return;
  }
  if (item.kind === 'link') {
    const a = document.createElement('a');
    a.textContent = item.text;
    caret.before(a);
    return;
  }
  if (item.text.includes('\\n') && /[{};]/.test(item.text)) {
    const pre = document.createElement('pre');
    pre.textContent = item.text;
    p.before(pre);
    return;
  }
  caret.before(document.createTextNode(item.text));
});
true;
`

function sceneHtml(palettePage) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${SCENE_CSS}</style></head><body>
<div class="editor">
  <div class="titlebar"><span class="app"></span>Weekly update — Notes<div class="dots"><span></span><span></span><span></span></div></div>
  <div class="toolbar"><span>Normal text</span><span class="sep"></span><span><b>B</b></span><span><i>I</i></span><span><u>U</u></span><span class="sep"></span><span>H1</span><span>H2</span><span>• List</span><span class="sep"></span><span>Link</span><span>Image</span><span>Code</span></div>
  <div class="doc">
    <h1>Weekly update</h1>
    <div class="sub">Product team · Week 42</div>
    <p>Onboarding redesign shipped on Tuesday. The source and the release notes are on GitHub: <span class="caret"></span></p>
  </div>
</div>
<div class="keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd></div>
<iframe src="${palettePage}"></iframe>
<script>${SCENE_JS}</script>
</body></html>`
}

module.exports = { sceneHtml }
