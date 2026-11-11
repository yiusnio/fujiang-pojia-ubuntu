import assert from 'node:assert/strict';
import test from 'node:test';
import { mountDisclaimer, readDisclaimerComponent } from './keyboard-harness.mjs';

const component = readDisclaimerComponent();
const KEY = 'dsh-prompt-custom-disclaimer-v1';
function createWindow({ accepted = false, storageFails = false } = {}) {
  const handlers = new Set();
  const stored = new Map(accepted ? [[KEY, 'accepted']] : []);
  return {
    handlers,
    stored,
    sessionStorage: {
      getItem(key) { if (storageFails) throw new Error('storage unavailable'); return stored.get(key) || null; },
      setItem(key, value) { if (storageFails) throw new Error('storage unavailable'); stored.set(key, value); }
    },
    addEventListener(type, handler, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); handlers.add(handler); },
    removeEventListener(type, handler, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); handlers.delete(handler); }
  };
}
function press(target, key, options = {}) {
  const event = {
    key, defaultPrevented: false, propagationStopped: false, ...options,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  for (const handler of [...target.handlers]) handler(event);
  return event;
}
function assertComposerKeysPass(target) {
  for (const [key, options] of [['Enter', {}], ['Enter', { shiftKey: true }], ['Escape', {}]]) {
    const event = press(target, key, options);
    assert.equal(event.defaultPrevented, false, `${key} must retain its native/input default`);
    assert.equal(event.propagationStopped, false, `${key} must reach the composer`);
  }
}

test('already accepted on initial mount leaves composer keys untouched', () => {
  const target = createWindow({ accepted: true });
  const gate = mountDisclaimer(component, target);
  assert.equal(gate.open, false);
  assert.equal(target.handlers.size, 0);
  assertComposerKeysPass(target);
  gate.unmount();
});

test('mouse acceptance removes capture listener and keeps it absent after rerenders', () => {
  const target = createWindow();
  const gate = mountDisclaimer(component, target);
  assert.equal(target.handlers.size, 1);
  gate.clickAccept();
  assert.equal(gate.open, false);
  assert.equal(target.stored.get(KEY), 'accepted');
  assert.equal(target.handlers.size, 0);
  gate.flush();
  assertComposerKeysPass(target);
});

for (const key of ['Enter', 'Escape']) {
  test(`${key} accepts an open disclaimer but later composer keys pass`, () => {
    const target = createWindow();
    const gate = mountDisclaimer(component, target);
    const closing = press(target, key);
    assert.equal(closing.defaultPrevented, true);
    assert.equal(closing.propagationStopped, true);
    gate.flush();
    assert.equal(gate.open, false);
    assert.equal(target.handlers.size, 0);
    assert.equal(target.stored.get(KEY), 'accepted');
    assertComposerKeysPass(target);
  });
}

for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
  test(`IME composition is not treated as acceptance: ${JSON.stringify(options)}`, () => {
    const target = createWindow();
    const gate = mountDisclaimer(component, target);
    for (const key of ['Enter', 'Escape']) {
      const event = press(target, key, options);
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.propagationStopped, false);
      assert.equal(gate.pending, false);
      assert.equal(gate.open, true);
      assert.equal(target.stored.has(KEY), false);
    }
    gate.unmount();
    assert.equal(target.handlers.size, 0);
  });
}

test('unrelated keys are not intercepted while the disclaimer is open', () => {
  const target = createWindow();
  const gate = mountDisclaimer(component, target);
  for (const key of ['a', 'Tab', 'ArrowLeft', 'Backspace']) {
    assert.equal(press(target, key).defaultPrevented, false);
    assert.equal(gate.pending, false);
  }
  gate.unmount();
});

test('storage failure still closes and releases keyboard events', () => {
  const target = createWindow({ storageFails: true });
  const gate = mountDisclaimer(component, target);
  gate.clickAccept();
  assert.equal(gate.open, false);
  assert.equal(target.handlers.size, 0);
  assertComposerKeysPass(target);
});

test('Strict Mode effect replay, repeated mounts, and unmount do not leak listeners', () => {
  const target = createWindow();
  for (let i = 0; i < 3; i++) {
    const gate = mountDisclaimer(component, target);
    assert.equal(target.handlers.size, 1);
    gate.replayEffect();
    assert.equal(target.handlers.size, 1);
    gate.unmount();
    assert.equal(target.handlers.size, 0);
  }
  const gate = mountDisclaimer(component, target);
  gate.clickAccept();
  gate.replayEffect();
  assert.equal(target.handlers.size, 0);
  gate.unmount();
  const remounted = mountDisclaimer(component, target);
  assert.equal(remounted.open, false);
  assert.equal(target.handlers.size, 0);
  assertComposerKeysPass(target);
});

test('two gate instances each release their own listener after keyboard acceptance', () => {
  const target = createWindow();
  const first = mountDisclaimer(component, target);
  const second = mountDisclaimer(component, target);
  assert.equal(target.handlers.size, 2);
  press(target, 'Enter');
  first.flush();
  second.flush();
  assert.equal(target.handlers.size, 0);
  assertComposerKeysPass(target);
});
