'use strict';

function fakeDocumentLock() {
  const state = { held: false, acquired: 0, released: 0, available: true, onAcquire: null };
  const lock = {
    tryLock() {
      if (!state.available || state.held) return false;
      if (state.onAcquire) state.onAcquire();
      state.held = true;
      state.acquired++;
      return true;
    },
    releaseLock() {
      state.held = false;
      state.released++;
    }
  };
  return { state, LockService: { getDocumentLock: () => lock, getScriptLock: () => lock } };
}

module.exports = { fakeDocumentLock };
