import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readDisclaimerComponent(sourcePath = process.env.CLIENT_SOURCE || fileURLToPath(new URL('../plugin/lib/client.js', import.meta.url))) {
  const source = readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('      function DisclaimerGate() {');
  const end = source.indexOf('      function PromptToggle(', start);
  if (start < 0 || end < 0) throw new Error('Cannot locate the real DisclaimerGate component');
  return source.slice(start, end);
}

// A minimal hook lifecycle for the real component, shared by Node regressions
// and the browser fixture. This does not reimplement the keyboard handler.
export function mountDisclaimer(componentSource, targetWindow, { render = () => {} } = {}) {
  let state;
  let initialized = false;
  let previousDeps;
  let nextEffect;
  let cleanup;
  let currentEffect;
  let scheduled = false;
  let tree;
  let mounted = true;
  const react = {
    useState(initial) {
      if (!initialized) { state = typeof initial === 'function' ? initial() : initial; initialized = true; }
      return [state, value => { state = typeof value === 'function' ? value(state) : value; scheduled = true; }];
    },
    useEffect(effect, deps) {
      if (!previousDeps || deps.some((value, i) => !Object.is(value, previousDeps[i]))) {
        previousDeps = deps;
        nextEffect = effect;
      }
    }
  };
  const jsx = (type, props) => ({ type, props });
  const component = Function('react', 'jsx', 'window', 'document', 'require', 'fetch', 'setTimeout',
    componentSource + '\nreturn DisclaimerGate;')(
      react, jsx, targetWindow, { body: {} }, () => ({ createPortal: root => root }),
      () => { throw new Error('Shutdown is not exercised by this fixture'); },
      () => { throw new Error('Shutdown is not exercised by this fixture'); }
    );
  function flush() {
    if (!mounted) return;
    scheduled = false;
    tree = component();
    render(tree);
    if (nextEffect) {
      if (cleanup) cleanup();
      currentEffect = nextEffect;
      nextEffect = undefined;
      cleanup = currentEffect();
    }
  }
  function findAccept(node) {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 'button' && node.props.children === '同意并遵守') return node.props.onClick;
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
    for (const child of children) { const found = findAccept(child); if (found) return found; }
  }
  flush();
  return {
    get open() { return tree !== null; },
    get pending() { return scheduled; },
    flush,
    clickAccept() { const accept = findAccept(tree); if (!accept) throw new Error('No open disclaimer'); accept(); flush(); },
    replayEffect() { if (cleanup) cleanup(); cleanup = currentEffect?.(); },
    unmount() { if (cleanup) cleanup(); cleanup = undefined; mounted = false; render(null); }
  };
}
