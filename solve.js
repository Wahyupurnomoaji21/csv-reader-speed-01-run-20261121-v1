// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers as csv-reader 1.0.0 for every input {text, header}:
// {columns, rows, errors}. Same broken-row policy, re-implemented from
// scratch for speed:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is
//     no record;
//   - outside a quoted field a CR not followed by LF is dropped
//     (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; what follows its closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when the
//     field ends); a quote that never closes is a literal character, and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     holds the records after it (every record when header is false), each
//     padded with "" (short_row, with fields: its count) or cut (long_row,
//     with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based
//     line its record starts on, row its record's index in rows (null for
//     the header).
//
// Speed: the reference walks one character at a time and builds every
// field a character at a time. This implementation instead:
//
//   - takes a fast path for a whole record at once when the record holds
//     no quote and no stray CR: one slice plus a native split(',');
//   - scans unquoted fields with one native regex scan to the next
//     delimiter (',', LF or CR) instead of stepping per character;
//   - finds a quoted field's closing quote with indexOf jumps and takes
//     the field as one slice when it holds no doubled quote and no CR,
//     only counting its line breaks;
//   - never uses a regex and never caches anything between calls: every
//     run(input) is standalone.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call
// to the next. Dependency-free ES module.

// How a field ended: 0 at a comma (the record goes on), 1 at a line break
// or 2 at the end of the text (the record ends).
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error of a record carries these two.
  let recordLine = 1;
  let recordRow = null;

  // One native scan for the next field delimiter (comma, CR or LF),
  // instead of three separate indexOf scans per field (the CR scan would
  // otherwise run far past the field whenever the text holds almost no CR).
  const DELIM = /[,\r\n]/g;
  // First quote or CR at or after a position, for the fast-path check.
  const QUOTE_CR = /["\r]/g;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field and how it ended; `added` counts the characters kept in this
  // call (not the ones `value` already held).
  function readUnquoted(value) {
    let added = 0;
    let v = value;
    while (pos < len) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        v += text.slice(pos);
        added += len - pos;
        pos = len;
        return { value: v, ended: END, added };
      }
      const idx = m.index;
      const ch = m[0];
      if (idx > pos) { v += text.slice(pos, idx); added += idx - pos; }
      if (ch === ',') {
        pos = idx + 1;
        return { value: v, ended: COMMA, added };
      }
      if (ch === '\n') {
        pos = idx + 1;
        line += 1;
        return { value: v, ended: LINE_BREAK, added };
      }
      // A CR: CRLF ends the field, a lone CR is dropped (stray_cr).
      if (text[idx + 1] === '\n') {
        pos = idx + 2;
        line += 1;
        return { value: v, ended: LINE_BREAK, added };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = idx + 1;
    }
    return { value: v, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: a quote followed by another quote is doubled.
    let j = pos + 1;
    let close = -1;
    while (true) {
      j = text.indexOf('"', j);
      if (j === -1) break;
      if (text[j + 1] === '"') { j += 2; continue; }
      close = j;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const raw = text.slice(open + 1, close);
    let value;
    if (raw.indexOf('"') === -1 && raw.indexOf('\r') === -1) {
      // Clean quoted field: take it as one slice, only count its LF.
      value = raw;
      let k = -1;
      while ((k = raw.indexOf('\n', k + 1)) !== -1) line += 1;
    } else {
      // Messy quoted field: "" becomes one quote, CRLF and lone CR each
      // become one LF (and count one line each).
      const parts = [];
      let p = 0;
      while (p < raw.length) {
        const qi = raw.indexOf('"', p);
        const ri = raw.indexOf('\r', p);
        const ni = raw.indexOf('\n', p);
        let m = -1;
        let kind = 0; // 0 quote, 1 CR, 2 LF
        if (qi !== -1) { m = qi; kind = 0; }
        if (ri !== -1 && (m === -1 || ri < m)) { m = ri; kind = 1; }
        if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 2; }
        if (m === -1) { parts.push(raw.slice(p)); break; }
        if (kind === 2) {
          parts.push(raw.slice(p, m + 1));
          line += 1;
          p = m + 1;
        } else {
          if (m > p) parts.push(raw.slice(p, m));
          if (kind === 0) {
            parts.push('"');
            p = m + 2; // a quote inside is always doubled here
          } else {
            parts.push('\n');
            line += 1;
            p = m + 1 + (raw[m + 1] === '\n' ? 1 : 0);
          }
        }
      }
      value = parts.join('');
    }
    pos = close + 1;
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Widths the finished record: header, or a row padded/cut to the first
  // record's width, with its short_row/long_row error when it ends.
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record holds no quote before its first LF and no
    // stray CR (a CR is allowed only as the CRLF that ends it). Then the
    // record is one slice split on commas; it can carry no error. One
    // native regex scan finds the first quote or CR: a quote means the
    // slow path, a CR anywhere but the record's last character (its
    // CRLF) means the slow path, and no match before the LF means clean.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    QUOTE_CR.lastIndex = pos;
    const sp = QUOTE_CR.exec(text);
    if (sp === null || sp.index >= end || (sp[0] === '\r' && nl !== -1 && sp.index === end - 1)) {
      const segEnd = sp !== null && sp.index === end - 1 ? end - 1 : end;
      const fields = text.slice(pos, segEnd).split(',');
      if (nl !== -1) { line += 1; pos = nl + 1; } else { pos = len; }
      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay). Unreachable on this path
      // (a stray CR would have sent the record the slow way), but kept
      // so the two paths cannot disagree.
      if (fields.length === 1 && fields[0] === '') continue;
      finish(fields);
      continue;
    }

    // Slow path: field by field, with indexOf jumps inside each field.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finish(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
