// Binds the editor's plain <textarea> to a Y.Text (plans/live-co-editing.md
// §5.3). Each local edit is diffed against the last value and applied as
// one Yjs edit. Remote edits wait in a queue and are applied once a frame,
// never during IME composition, with the caret mapped past them, so the
// Y.Text, the last value and the textarea agree at every input event. Undo
// covers only this person's own edits.
(function exposeLiveBinding(root) {
  'use strict';

  const LOCAL_ORIGIN = 'local-typing';
  const REMOTE_ORIGIN = 'remote';
  const TEXT_FIELD = 'body';
  // Keystrokes this close together undo as one step.
  const UNDO_CAPTURE_MS = 500;
  const MAX_BODY_LENGTH = 500000;

  function isModifierKey(event) {
    return (event.ctrlKey || event.metaKey) && !event.altKey;
  }

  function isRedoKey(event) {
    const key = String(event.key).toLowerCase();
    return isModifierKey(event) && ((key === 'z' && event.shiftKey) || key === 'y');
  }

  function isUndoKey(event) {
    return isModifierKey(event) && String(event.key).toLowerCase() === 'z' && !event.shiftKey;
  }

  // Where the first change in a delta starts.
  function firstChangeIndex(delta) {
    return delta.length && delta[0].retain ? delta[0].retain : 0;
  }

  class TextBinding {
    constructor(options) {
      Object.assign(this, options);
      this.ytext = this.doc.getText(TEXT_FIELD);
      this.undoManager = new this.Y.UndoManager(this.ytext, {
        trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: UNDO_CAPTURE_MS,
      });
      this.lastValue = this.textarea.value;
      this.queue = [];
      this.deltas = [];
      this.isComposing = false;
      this.isFlushScheduled = false;
      this.observer = event => {
        if (event.transaction.origin !== LOCAL_ORIGIN) this.deltas.push(event.delta);
      };
      this.ytext.observe(this.observer);
      this.listen();
    }

    listen() {
      this.listeners = {
        input: () => this.handleInput(),
        compositionstart: () => { this.isComposing = true; },
        compositionend: () => this.handleCompositionEnd(),
        beforeinput: event => this.handleBeforeInput(event),
        keydown: event => this.handleKeydown(event),
      };
      for (const [type, listener] of Object.entries(this.listeners)) this.textarea.addEventListener(type, listener);
    }

    // Every input counts, trusted or not: the mobile rhyme swap is untrusted.
    handleInput() {
      const value = this.textarea.value;
      if (value === this.lastValue) return;
      // Only growth is refused: a page others pushed past the cap can still shrink.
      if (value.length > MAX_BODY_LENGTH && value.length > this.lastValue.length) return this.revert();
      const edit = this.liveCore.diffTextEdit(this.lastValue, value, this.textarea.selectionEnd);
      this.liveCore.applyEdit(this.ytext, edit, LOCAL_ORIGIN);
      this.lastValue = value;
    }

    revert() {
      const caret = Math.min(this.textarea.selectionStart, this.lastValue.length);
      this.textarea.value = this.lastValue;
      this.textarea.setSelectionRange(caret, caret);
      this.textarea.dispatchEvent(new Event('input'));
      this.onTooLong();
    }

    queueRemote(update) {
      this.queue.push(update);
      this.scheduleFlush();
    }

    scheduleFlush() {
      if (this.isFlushScheduled || this.isComposing) return;
      this.isFlushScheduled = true;
      this.schedule(() => this.flush());
    }

    // Setting the value mid-composition would break it (iOS dictation and
    // predictive text, CJK input), so the queue waits for compositionend.
    flush() {
      this.isFlushScheduled = false;
      if (this.isComposing || !this.queue.length) return;
      this.Y.applyUpdate(this.doc, this.Y.mergeUpdates(this.queue.splice(0)), REMOTE_ORIGIN);
      this.render();
    }

    handleCompositionEnd() {
      this.isComposing = false;
      this.scheduleFlush();
    }

    // Shows what Yjs now holds, keeping the selection on the same words and
    // the caret's line where it was on screen.
    render() {
      const deltas = this.deltas.splice(0);
      const value = this.ytext.toString();
      if (!deltas.length || value === this.textarea.value) {
        this.lastValue = value;
        return;
      }
      let selection = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
      for (const delta of deltas) selection = this.liveCore.mapSelection(selection, delta);
      const heightBefore = this.textarea.scrollHeight;
      const isFocused = this.isFocused();
      this.textarea.value = value;
      this.lastValue = value;
      if (isFocused) this.textarea.setSelectionRange(selection.start, selection.end);
      this.textarea.dispatchEvent(new Event('input'));
      const isAboveCaret = Math.min(...deltas.map(firstChangeIndex)) < selection.start;
      if (isAboveCaret) this.adjustScroll(this.textarea.scrollHeight - heightBefore);
    }

    applyLocalText(text) {
      const edits = this.liveCore.minimalEdits(this.dmp, this.lastValue, text);
      this.liveCore.applyEdits(this.ytext, edits, LOCAL_ORIGIN);
      this.textarea.value = text;
      this.lastValue = text;
      this.textarea.dispatchEvent(new Event('input'));
    }

    handleBeforeInput(event) {
      if (event.inputType === 'historyUndo') this.runHistory(event, () => this.undo());
      else if (event.inputType === 'historyRedo') this.runHistory(event, () => this.redo());
    }

    handleKeydown(event) {
      if (isRedoKey(event)) this.runHistory(event, () => this.redo());
      else if (isUndoKey(event)) this.runHistory(event, () => this.undo());
    }

    // Where a browser will not let the event be cancelled, its own undo runs
    // and arrives as an ordinary input, which syncs like any edit.
    runHistory(event, step) {
      event.preventDefault();
      step();
    }

    undo() {
      this.flush();
      this.undoManager.undo();
      this.render();
    }

    redo() {
      this.flush();
      this.undoManager.redo();
      this.render();
    }

    destroy() {
      for (const [type, listener] of Object.entries(this.listeners)) this.textarea.removeEventListener(type, listener);
      this.ytext.unobserve(this.observer);
      this.undoManager.destroy();
    }
  }

  function createTextBinding(options) {
    return new TextBinding({
      schedule: frame => requestAnimationFrame(frame),
      isFocused: () => document.activeElement === options.textarea,
      onTooLong: () => {},
      adjustScroll: () => {},
      ...options,
    });
  }

  const LiveBinding = { LOCAL_ORIGIN, REMOTE_ORIGIN, MAX_BODY_LENGTH, createTextBinding };

  if (typeof module === 'object' && module.exports) {
    module.exports = LiveBinding;
  } else {
    root.LiveBinding = LiveBinding;
  }
})(globalThis);
