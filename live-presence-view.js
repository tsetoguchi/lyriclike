// Draws presence (plans/live-co-editing.md §5.4): co-writers' carets and
// selections over the editor, and who is here as initials, in the title
// row on desktop and on the sharing line on phones, which hide the title
// row. The carets sit in two layers beside #lyrics-highlight, laid out like
// it, because that layer is rebuilt on every keystroke.
(function exposeLivePresenceView(root) {
  'use strict';

  // How long a name tag stays after someone arrives, or after the pointer
  // was last near their caret.
  const TAG_SHOW_MS = 3000;
  // How close, in CSS pixels, a pointer or tap must come to a caret.
  const HIT_SLOP_PX = 8;
  const MAX_CHIPS = 4;
  const HERE_NOTE = 'here now';
  const NO_PAINTER = Object.freeze({ show() {} });

  function chipModel(people) {
    return { shown: people.slice(0, MAX_CHIPS), extra: Math.max(0, people.length - MAX_CHIPS) };
  }

  function peopleLabel(people) {
    return people.length ? `Here now: ${people.map(entry => entry.name).join(', ')}` : '';
  }

  function textNodesOf(element) {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let start = 0;
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start });
      start += walker.currentNode.length;
    }
    return nodes;
  }

  // The text node holding the letter at `index`, and where in it.
  function locate(nodes, index) {
    let found = null;
    for (const entry of nodes) {
      if (entry.start > index) break;
      found = entry;
    }
    return found && { node: found.node, offset: index - found.start };
  }

  // Positions in the highlight layer, which draws every letter where the
  // textarea has it, relative to the wrapper that all the layers fill.
  class Measurer {
    constructor(highlight, wrapper) {
      this.nodes = textNodesOf(highlight);
      this.origin = wrapper.getBoundingClientRect();
      this.range = highlight.ownerDocument.createRange();
    }

    relative(rect) {
      return {
        left: rect.left - this.origin.left, top: rect.top - this.origin.top,
        width: rect.width, height: rect.height,
      };
    }

    // A caret's left edge is the left edge of the letter after it. The layer
    // ends with an extra newline, so there is always a letter after.
    caretRect(index) {
      const at = locate(this.nodes, index);
      if (!at || at.offset >= at.node.length) return null;
      this.range.setStart(at.node, at.offset);
      this.range.setEnd(at.node, at.offset + 1);
      const rect = this.range.getClientRects()[0];
      return rect ? this.relative(rect) : null;
    }

    // Text boxes only: a range's rects also include whole word elements,
    // whose hit padding would tint the selection twice.
    rangeRects(start, end) {
      const rects = [];
      for (const { node, start: nodeStart } of this.nodes) {
        const from = Math.max(start, nodeStart);
        const to = Math.min(end, nodeStart + node.length);
        if (from >= to) continue;
        this.range.setStart(node, from - nodeStart);
        this.range.setEnd(node, to - nodeStart);
        for (const rect of this.range.getClientRects()) rects.push(this.relative(rect));
      }
      return rects;
    }
  }

  // The person's colour rides in a custom property; styles.css owns the rest.
  function placed(className, rect, colour) {
    const element = document.createElement('div');
    element.className = className;
    element.style.setProperty('--who', colour);
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.height = `${rect.height}px`;
    return element;
  }

  function tintEl(rect, colour) {
    const tint = placed('presence-selection', rect, colour);
    tint.style.width = `${rect.width}px`;
    return tint;
  }

  function chipEl(text, colour, title) {
    const chip = document.createElement('span');
    chip.className = 'presence-chip';
    chip.textContent = text;
    if (colour) chip.style.setProperty('--who', colour);
    if (title) chip.title = title;
    return chip;
  }

  function noteEl(text) {
    const note = document.createElement('span');
    note.className = 'presence-note';
    note.textContent = text;
    return note;
  }

  function fillChips(host, people, note) {
    const { shown, extra } = chipModel(people);
    const parts = shown.map(entry => chipEl(entry.initials, entry.colour, entry.name));
    if (extra) parts.push(chipEl(`+${extra}`, null, ''));
    if (note) parts.push(noteEl(note));
    host.replaceChildren(...parts);
    host.setAttribute('aria-label', peopleLabel(people));
  }

  class PresencePainter {
    constructor(elements) {
      Object.assign(this, elements);
      this.view = { people: [], carets: [] };
      this.seen = new Set();
      this.tagTimers = new Map();
      this.isDrawDue = false;
      this.listen();
    }

    listen() {
      const showNear = event => this.showTagsNear(event.clientX, event.clientY);
      this.textarea.addEventListener('pointermove', showNear, { passive: true });
      this.textarea.addEventListener('pointerdown', showNear, { passive: true });
      // Phones have no Share button on screen; its click opens the same list.
      const openPeople = () => this.shareButton.click();
      this.header.addEventListener('click', openPeople);
      this.phoneLine.addEventListener('click', openPeople);
      if (root.ResizeObserver) new root.ResizeObserver(() => this.scheduleDraw()).observe(this.wrapper);
    }

    show(view) {
      this.noteArrivals(view.carets);
      this.view = view;
      this.drawPeople();
      this.scheduleDraw();
    }

    // A caret that was not on screen a moment ago is someone arriving.
    noteArrivals(carets) {
      const present = new Set(carets.map(caret => caret.clientID));
      for (const clientID of present) if (!this.seen.has(clientID)) this.showTag(clientID);
      this.seen = present;
    }

    showTag(clientID) {
      root.clearTimeout(this.tagTimers.get(clientID));
      this.tagTimers.set(clientID, root.setTimeout(() => {
        this.tagTimers.delete(clientID);
        this.setTagShown(clientID, false);
      }, TAG_SHOW_MS));
      this.setTagShown(clientID, true);
    }

    setTagShown(clientID, isShown) {
      const caret = this.over.querySelector(`[data-client="${clientID}"]`);
      if (caret) caret.classList.toggle('is-tag-shown', isShown);
    }

    showTagsNear(x, y) {
      for (const caret of this.over.children) {
        const rect = caret.getBoundingClientRect();
        const isNear = Math.abs(x - rect.left) <= HIT_SLOP_PX
          && y >= rect.top - HIT_SLOP_PX && y <= rect.bottom + HIT_SLOP_PX;
        if (isNear) this.showTag(Number(caret.dataset.client));
      }
    }

    scheduleDraw() {
      if (this.isDrawDue) return;
      this.isDrawDue = true;
      root.requestAnimationFrame(() => {
        this.isDrawDue = false;
        this.drawCarets();
      });
    }

    // On the next frame, once the binding has shown the words the
    // positions count in.
    drawCarets() {
      const measure = new Measurer(this.highlight, this.wrapper);
      const length = this.textarea.value.length;
      const tints = [];
      const bars = [];
      for (const caret of this.view.carets) {
        const end = Math.min(caret.end, length);
        for (const rect of measure.rangeRects(Math.min(caret.start, end), end)) tints.push(tintEl(rect, caret.colour));
        const at = measure.caretRect(Math.min(caret.head, length));
        if (at) bars.push(this.caretEl(caret, at));
      }
      this.under.replaceChildren(...tints);
      this.over.replaceChildren(...bars);
    }

    caretEl(caret, rect) {
      const bar = placed('presence-caret', rect, caret.colour);
      bar.dataset.client = String(caret.clientID);
      bar.classList.toggle('is-tag-shown', this.tagTimers.has(caret.clientID));
      const tag = document.createElement('span');
      tag.className = 'presence-tag';
      tag.textContent = caret.name;
      bar.append(tag);
      return bar;
    }

    drawPeople() {
      const { people } = this.view;
      const isAnyoneHere = people.length > 0;
      this.panel.toggleAttribute('data-people', isAnyoneHere);
      this.header.hidden = !isAnyoneHere;
      this.phoneLine.hidden = !isAnyoneHere;
      fillChips(this.header, people);
      fillChips(this.phoneLine, people, HERE_NOTE);
    }
  }

  // A cached index.html from before presence has no layers: draw nothing.
  function createPainter(doc) {
    const elements = {
      wrapper: doc.querySelector('.lyrics-wrapper'),
      highlight: doc.getElementById('lyrics-highlight'),
      textarea: doc.getElementById('lyrics'),
      under: doc.getElementById('presence-under'),
      over: doc.getElementById('presence-over'),
      panel: doc.querySelector('.lyrics-panel'),
      header: doc.getElementById('presence-header'),
      phoneLine: doc.getElementById('page-presence'),
      shareButton: doc.getElementById('share-btn'),
    };
    if (Object.values(elements).some(element => !element)) return NO_PAINTER;
    return new PresencePainter(elements);
  }

  const LivePresenceView = { TAG_SHOW_MS, MAX_CHIPS, chipModel, peopleLabel, createPainter };

  if (typeof module === 'object' && module.exports) {
    module.exports = LivePresenceView;
  } else {
    root.LivePresenceView = LivePresenceView;
  }
})(this);
