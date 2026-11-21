// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input)
// returns the same {columns, rows, errors} for every input, faster.
//
// Semantics (from the reference spec): a U+FEFF at the very start is dropped;
// a record ends at LF or CRLF and a line with no characters is no record; a CR
// outside quotes not followed by LF is dropped (stray_cr); a field opening with
// a quote runs to the next quote that is not doubled, "" inside is one quote,
// each CRLF or lone CR inside is read as LF, what follows the closing quote up
// to the next comma or line break is appended as it stands (quote_junk when
// anything was appended); a quote that never closes is a literal character and
// the text after it is read again as unquoted (unterminated_quote); a quote
// inside an unquoted field is literal; fields stay strings, never trimmed;
// columns is the first record when header is true, else null; rows hold the
// records after it, each padded with "" (short_row, with fields: its count) or
// cut (long_row, with extra: the cut fields) to the first record's width; each
// error is {code, line, row}, line the 1-based line its record starts on, row
// its index in rows (null for the header), in the order met.
//
// Speed: one pass, fields as slices (no per-character string building), the
// next delimiter found by a tight charCodeAt loop, quoted fields jumped with
// indexOf, no object allocated per field (one shared scratch object).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // Scratch for the readers below, so no object is allocated per field.
  const R = { v: null, e: 0, a: 0, p: 0, l: 1 };

  // Read an unquoted field starting at `start` with initial value `init`.
  // Sets R.v (value), R.e (ended: 0 comma, 1 line break, 2 end),
  // R.a (characters kept), R.p (new pos), R.l (new line).
  function readUnquoted(init, start, startLine, rl, rr) {
    let v = init === '' ? null : init;
    let seg = start;
    let added = 0;
    let p = start;
    let ln = startLine;
    for (;;) {
      let i = p;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
      if (i >= n) {
        v = v === null ? text.slice(seg) : v + text.slice(seg);
        added += n - seg;
        R.v = v === null ? '' : v; R.e = END; R.a = added; R.p = n; R.l = ln;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        v = v === null ? text.slice(seg, i) : v + text.slice(seg, i);
        added += i - seg;
        R.v = v === null ? '' : v; R.e = COMMA; R.a = added; R.p = i + 1; R.l = ln;
        return;
      }
      if (c === 10) {
        v = v === null ? text.slice(seg, i) : v + text.slice(seg, i);
        added += i - seg;
        R.v = v === null ? '' : v; R.e = LINE_BREAK; R.a = added; R.p = i + 1; R.l = ln + 1;
        return;
      }
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        v = v === null ? text.slice(seg, i) : v + text.slice(seg, i);
        added += i - seg;
        R.v = v === null ? '' : v; R.e = LINE_BREAK; R.a = added; R.p = i + 2; R.l = ln + 1;
        return;
      }
      errors.push({ code: 'stray_cr', line: rl, row: rr });
      v = v === null ? text.slice(seg, i) : v + text.slice(seg, i);
      added += i - seg;
      p = i + 1;
      seg = p;
    }
  }

  // Append quoted segment text[a..b) to `cur` (null = none yet), turning each
  // CR or CRLF into one LF and counting lines. Sets R.v (new value) and R.l.
  function addSeg(cur, a, b, ln) {
    let out = cur;
    let i = a;
    while (i < b) {
      const r = text.indexOf('\r', i);
      const nl = text.indexOf('\n', i);
      let next = -1;
      let isCR = false;
      if (r !== -1 && r < b) { next = r; isCR = true; }
      if (nl !== -1 && nl < b && (next === -1 || nl < next)) { next = nl; isCR = false; }
      if (next === -1) {
        const s = text.slice(i, b);
        out = out === null ? s : out + s;
        break;
      }
      if (next > i) {
        const s = text.slice(i, next);
        out = out === null ? s : out + s;
      }
      out = out === null ? '\n' : out + '\n';
      ln++;
      i = next + 1;
      if (isCR && i < b && text.charCodeAt(i) === 10) i++;
    }
    R.v = out;
    R.l = ln;
  }

  recordLoop: while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let quoted = false;

    fieldLoop: while (true) {
      let value;
      let ended;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        let qval = null;
        let segStart = pos + 1;
        let p = pos + 1;
        let closed = false;
        let closePos = -1;
        while (true) {
          const q = text.indexOf('"', p);
          if (q === -1) break;
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
            addSeg(qval, segStart, q, line);
            qval = R.v;
            line = R.l;
            qval = qval === null ? '"' : qval + '"';
            p = q + 2;
            segStart = p;
            continue;
          }
          closed = true;
          closePos = q;
          break;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted('"', pos, line, recordLine, recordRow);
          value = R.v; ended = R.e; pos = R.p; line = R.l;
        } else {
          addSeg(qval, segStart, closePos, line);
          qval = R.v;
          line = R.l;
          if (qval === null) qval = '';
          pos = closePos + 1;
          if (pos >= n) {
            value = qval; ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos++; value = qval; ended = COMMA; }
            else if (c === 10) { pos++; line++; value = qval; ended = LINE_BREAK; }
            else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; value = qval; ended = LINE_BREAK; }
            else {
              // What follows the closing quote is appended as it stands.
              readUnquoted(qval, pos, line, recordLine, recordRow);
              if (R.a > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = R.v; ended = R.e; pos = R.p; line = R.l;
            }
          }
        }
      } else {
        quoted = false;
        readUnquoted('', pos, line, recordLine, recordRow);
        value = R.v; ended = R.e; pos = R.p; line = R.l;
      }
      fields.push(value);
      if (ended !== COMMA) break fieldLoop;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue recordLoop;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue recordLoop;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
