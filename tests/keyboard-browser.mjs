import http from 'node:http';
import { mountDisclaimer, readDisclaimerComponent } from './keyboard-harness.mjs';

// Native textarea/default keyboard behavior, using the actual bundled component
// with a small hook lifecycle. No Harness profile, model, or prompt file is used.
const component = readDisclaimerComponent();
const page = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Disclaimer keyboard regression</title>
<style>body{font:16px system-ui;max-width:850px;margin:30px auto}textarea{display:block;width:100%;height:160px;margin:18px 0}button{margin:5px;padding:8px}pre{background:#eee;padding:16px}</style>
<h1>Disclaimer keyboard regression</h1>
<p>This isolated fixture runs the real plugin component with a minimal hook lifecycle. It never reads the custom prompt or calls a model.</p>
<button id="reset-open">Reset visible gate</button><button id="reset-accepted">Reset already accepted</button>
<button id="accept">Simulate mouse acceptance</button><button id="strict">Replay effect</button><button id="unmount">Unmount gate</button>
<button id="ime">Dispatch IME Enter</button>
<label for="composer">Composer</label><textarea id="composer" placeholder="Enter sends; Shift+Enter inserts a newline; Escape increments the escape count."></textarea>
<pre id="status" aria-live="polite"></pre>
<script>
const componentSource = ${JSON.stringify(component).replaceAll('<', '\\u003c')};
const mountDisclaimer = ${mountDisclaimer.toString()};
const KEY = 'dsh-prompt-custom-disclaimer-v1';
const stored = new Map();
const handlers = new Map();
let gate;
let sent = 0;
let escapes = 0;
let ime = null;
const composer = document.getElementById('composer');
const status = document.getElementById('status');
const target = {
  sessionStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
  addEventListener(type, fn, capture) {
    const wrapper = event => { fn(event); queueMicrotask(() => { if (gate?.pending) gate.flush(); update(); }); };
    handlers.set(fn, wrapper); window.addEventListener(type, wrapper, capture);
  },
  removeEventListener(type, fn, capture) { const wrapper = handlers.get(fn); if (wrapper) window.removeEventListener(type, wrapper, capture); handlers.delete(fn); }
};
function update() { status.textContent = JSON.stringify({ gateOpen: gate?.open ?? false, captureListeners: handlers.size, accepted: stored.get(KEY) === 'accepted', sent, escapes, text: composer.value, ime }, null, 2); }
function reset(accepted) {
  gate?.unmount(); gate = null; stored.clear();
  if (accepted) stored.set(KEY, 'accepted');
  composer.value = ''; sent = 0; escapes = 0; ime = null;
  gate = mountDisclaimer(componentSource, target); update();
}
document.getElementById('reset-open').onclick = () => reset(false);
document.getElementById('reset-accepted').onclick = () => reset(true);
document.getElementById('accept').onclick = () => { gate.clickAccept(); update(); composer.focus(); };
document.getElementById('strict').onclick = () => { gate.replayEffect(); update(); };
document.getElementById('unmount').onclick = () => { gate.unmount(); gate = null; update(); };
document.getElementById('ime').onclick = () => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
  composer.dispatchEvent(event); if (gate?.pending) gate.flush();
  ime = { defaultPrevented: event.defaultPrevented, gateOpen: gate?.open }; update();
};
composer.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sent++; composer.value = ''; }
  if (event.key === 'Escape') escapes++;
  update();
});
composer.addEventListener('input', update);
reset(new URLSearchParams(location.search).get('accepted') === '1');
</script></html>`;
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
});
server.listen(Number(process.env.PORT || 8765), '127.0.0.1', () => {
  console.log(`Keyboard fixture: http://127.0.0.1:${server.address().port}/`);
});
