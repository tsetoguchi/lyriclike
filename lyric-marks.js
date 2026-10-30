// The marks a whole lyric gets, line by line: which stanza each line is in,
// its rhyme letter, and where its internal rhymes start. rhyme-core.js judges
// one stanza at a time; this places its answers back in the whole text.
// Nothing here touches the page, so all of it is covered by the tests in test/.
(function exposeLyricMarks(root) {
  'use strict';

  const RhymeCore = typeof module === 'object' && module.exports
    ? require('./rhyme-core.js')
    : root.RhymeCore;

  const NEWLINE_LENGTH = 1;
  const NO_LETTER = '';

  function isBlankLine(line) {
    return line.trim() === '';
  }

  function splitIntoStanzas(allLines, lineCount) {
    const stanzas = [];
    const stanzaStartIndices = [];
    let currentStanza = [];
    let currentStart = 0;

    for (let i = 0; i < lineCount; i++) {
      if (isBlankLine(allLines[i])) {
        if (currentStanza.length > 0) {
          stanzas.push(currentStanza);
          stanzaStartIndices.push(currentStart);
          currentStanza = [];
        }
        continue;
      }
      if (currentStanza.length === 0) currentStart = i;
      currentStanza.push(allLines[i]);
    }
    if (currentStanza.length > 0) {
      stanzas.push(currentStanza);
      stanzaStartIndices.push(currentStart);
    }

    return { stanzas, stanzaStartIndices };
  }

  // The character offset each line starts at within the whole text, which is
  // what the highlight layer keys its word spans by.
  function lineStartOffsets(allLines) {
    const offsets = [];
    let offset = 0;
    for (const line of allLines) {
      offsets.push(offset);
      offset += line.length + NEWLINE_LENGTH;
    }
    return offsets;
  }

  // A stanza has no blank lines, so its lines are the next non-blank lines
  // from where it starts.
  function placeStanzaLetters(letters, allLines, startIdx, scheme) {
    let stanzaLineIdx = 0;
    for (let lineIdx = startIdx; lineIdx < letters.length; lineIdx++) {
      if (stanzaLineIdx >= scheme.length) return;
      if (isBlankLine(allLines[lineIdx])) continue;
      letters[lineIdx] = scheme[stanzaLineIdx];
      stanzaLineIdx++;
    }
  }

  // Each line's rhyme letter, worked out stanza by stanza. Blank lines get
  // none.
  function schemeLetters(index, allLines, lineCount) {
    const letters = new Array(lineCount).fill(NO_LETTER);
    const { stanzas, stanzaStartIndices } = splitIntoStanzas(allLines, lineCount);
    for (let s = 0; s < stanzas.length; s++) {
      const scheme = RhymeCore.computeRhymeScheme(index, stanzas[s]);
      placeStanzaLetters(letters, allLines, stanzaStartIndices[s], scheme);
    }
    return letters;
  }

  // Map<offset in the whole text, { family, stanza, isSlant }> for every
  // internal-rhyme mark.
  function internalRhymeMarks(index, allLines, lineCount) {
    const { stanzas, stanzaStartIndices } = splitIntoStanzas(allLines, lineCount);
    const starts = lineStartOffsets(allLines);
    const map = new Map();
    for (let s = 0; s < stanzas.length; s++) {
      const { marks } = RhymeCore.groupRhymeMarks(index, stanzas[s]);
      const startIdx = stanzaStartIndices[s];
      for (let lineIdx = 0; lineIdx < marks.length; lineIdx++) {
        const lineStart = starts[startIdx + lineIdx];
        for (const mark of marks[lineIdx]) {
          const { family, isSlant } = mark;
          map.set(lineStart + mark.start, { family, stanza: s, isSlant });
        }
      }
    }
    return map;
  }

  const LyricMarks = { splitIntoStanzas, lineStartOffsets, schemeLetters, internalRhymeMarks };

  if (typeof module === 'object' && module.exports) {
    module.exports = LyricMarks;
  } else {
    root.LyricMarks = LyricMarks;
  }
})(this);
