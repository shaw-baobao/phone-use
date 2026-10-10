// Capture committed browser text (including IME) without forwarding preedit text.
export function bindKeyboard(element, { context, send, onError, delay = 80 }) {
  let queue = [], session, composing = false, compositionSession, sending = false, timer;
  const reset = () => { clearTimeout(timer); queue = []; element.value = ''; composing = false; compositionSession = undefined; session = undefined; };
  const update = () => {
    const current = context();
    if (!current || (session && session !== current.session)) reset();
    element.disabled = !current;
  };
  const pump = async () => {
    clearTimeout(timer);
    if (sending || !queue.length) return;
    const current = context();
    if (!current || current.session !== session) { reset(); return; }
    if (!current.ready) { timer = setTimeout(pump, delay); return; }
    const action = queue.shift(); sending = true;
    try { await send({ ...action, session: current.session, frameSeq: current.frameSeq }); }
    catch (error) { if (session === current.session) { reset(); onError(error.message); } }
    finally { sending = false; if (queue.length) timer = setTimeout(pump, delay); }
  };
  const enqueue = action => {
    const current = context();
    if (!current) { reset(); return; }
    if (session && session !== current.session) reset();
    session = current.session;
    const size = queue.reduce((sum, item) => sum + (item.text?.length || 1), 0);
    if (size + (action.text?.length || 1) > 4000) { onError('Keyboard buffer is full. Wait before typing more.'); return; }
    const last = queue.at(-1);
    if (last?.action === 'text' && action.action === 'text') last.text += action.text;
    else queue.push(action);
    clearTimeout(timer); timer = setTimeout(pump, delay);
  };
  const commit = () => {
    const text = element.value; element.value = '';
    if (text) enqueue({ action: 'text', text });
  };
  element.addEventListener('compositionstart', () => { composing = true; compositionSession = context()?.session; session = compositionSession; });
  element.addEventListener('compositionend', () => {
    composing = false;
    if (compositionSession && compositionSession === context()?.session) commit();
    else element.value = '';
    compositionSession = undefined;
  });
  element.addEventListener('input', event => { if (!composing && !event.isComposing) commit(); });
  element.addEventListener('paste', event => {
    if (composing) return;
    const text = event.clipboardData?.getData('text/plain');
    if (text) { event.preventDefault(); enqueue({ action: 'text', text }); }
  });
  element.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    const keys = { Backspace: 'backspace', Delete: 'delete', Enter: 'enter', Tab: 'tab', Escape: 'escape', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    let key = keys[event.key];
    if (event.metaKey || event.ctrlKey) {
      // Paste is handled by the browser paste event; other host shortcuts stay local.
      if (!['a', 'z'].includes(event.key.toLowerCase())) return;
      key = event.key.toLowerCase();
    }
    if (!key) return;
    event.preventDefault();
    const modifiers = [event.metaKey ? (context()?.platform === 'android' ? 'ctrl' : 'cmd') : event.ctrlKey ? 'ctrl' : null, event.altKey ? 'alt' : null, event.shiftKey ? 'shift' : null].filter(Boolean);
    enqueue({ action: 'key', key: [...modifiers, key].join('+') });
  });
  element.addEventListener('blur', reset);
  return { update, reset, focus() { update(); if (!element.disabled) element.focus({ preventScroll: true }); } };
}
