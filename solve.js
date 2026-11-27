// diff-speed: a fast, dependency-free drop-in for makefun-diff 1.0.0.
//
// It returns exactly makefun-diff's answer for every input: the common
// line prefix is kept, then the common suffix of what is left; between
// them the greedy Myers search of the reference runs, keeping on each
// diagonal the path furthest into the old text, preferring a deletion
// over an insertion when both reach the same point, never moving past
// either text's end, pruning no edge diagonal, and following every run
// of equal lines to its end. The patch grammar is the reference's: the
// header line, hunks with 3 context lines, runs at most 6 kept lines
// apart sharing a hunk, deletions listed before insertions in a run, and
// a "%" line after a final line with no newline.
//
// The speed comes from two choices. Lines are interned to small
// integers (one Map per case; a line's code also carries whether it ends
// with "\n", so two lines are equal exactly when their codes are equal),
// so the hot loops compare integers, never strings. And the Myers
// search keeps its V-trace as one Int32Array per depth, each row a
// tight array the hot loop reads through locals, so backtracking needs
// no linked lists and the search allocates only the rows themselves.
//
// SPDX-License-Identifier: MIT

/** Op codes for the edit script. */
const KEEP = 0;
const DEL = 1;
const INS = 2;

/** Kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * The edit script of the interned middle slices A (length n) into B
 * (length m), as a flat array of op codes in forward order, following
 * the reference's greedy Myers search exactly: for d = 0, 1, ... and
 * each diagonal k from -d to d in steps of 2, the furthest point a path
 * of d edits reaches on k is one old line past the furthest (d-1)-point
 * on k-1 (a deletion) or one new line past the furthest (d-1)-point on
 * k+1 (an insertion), whichever lies further into the old text, the
 * deletion when both reach the same point; a move past the end of
 * either text is no candidate. From that point the path follows every
 * equal line as far as it goes. The first path to reach both ends is
 * the script, recovered by walking the V-trace back.
 */
function myersOps(A, B, n, m) {
  // The V-trace: one Int32Array per depth d, holding the furthest x
  // reached on each diagonal after d edits and its snake. Row d has
  // 2*d+1 entries, the entry for diagonal k at k+d. A cell stores x+1,
  // so 0 means its diagonal was never reached and no row needs
  // clearing; the rows are kept for the walk back. Rows beat one flat
  // buffer here: each row is a small array the hot loop reaches through
  // a local, with no growth copies and no closure-held buffer.
  const rows = [];
  let x = 0;
  while (x < n && x < m && A[x] === B[x]) x++;
  const row0 = new Int32Array(1);
  row0[0] = x + 1;
  rows.push(row0);
  let dFinal = 0;
  if (x < n || x < m) {
    let done = false;
    for (let d = 1; !done; d++) {
      const prev = rows[d - 1];
      const cur = new Int32Array(2 * d + 1);
      for (let k = -d; k <= d; k += 2) {
        // The (d-1)-points on the neighbouring diagonals, -1 when that
        // diagonal was never reached or is out of range at d-1.
        const down = k > -d ? prev[k + d - 2] - 1 : -1;
        const up = k < d ? prev[k + d] - 1 : -1;
        // A deletion is possible when the k-1 point has an old line
        // left to consume; an insertion when the k+1 point has a new
        // line left. The deletion wins when both reach the same point.
        let nextX;
        if (down >= 0 && down < n && (up < 0 || up - (k + 1) >= m || down + 1 >= up)) {
          nextX = down + 1;
        } else if (up >= 0 && up - (k + 1) < m) {
          nextX = up;
        } else {
          continue;
        }
        let y = nextX - k;
        while (nextX < n && y < m && A[nextX] === B[y]) {
          nextX++;
          y++;
        }
        cur[k + d] = nextX + 1;
        if (nextX >= n && y >= m) {
          dFinal = d;
          done = true;
          break;
        }
      }
      rows.push(cur);
    }
  }

  // Walk the trace back from (n, m), undoing one edit per depth and
  // the snake that followed it, collecting single-line ops in reverse.
  const rev = new Int8Array(n + m + 1);
  let rp = n + m + 1;
  x = n;
  let y = m;
  for (let d = dFinal; d > 0; d--) {
    const k = x - y;
    const prev = rows[d - 1];
    const down = k > -d ? prev[k + d - 2] - 1 : -1;
    const up = k < d ? prev[k + d] - 1 : -1;
    let prevX;
    let prevY;
    let midX;
    let midY;
    let kind;
    if (down >= 0 && down < n && (up < 0 || up - (k + 1) >= m || down + 1 >= up)) {
      prevX = down;
      prevY = down - (k - 1);
      midX = down + 1;
      midY = prevY;
      kind = DEL;
    } else {
      prevX = up;
      prevY = up - (k + 1);
      midX = up;
      midY = prevY + 1;
      kind = INS;
    }
    while (x > midX) {
      rev[--rp] = KEEP;
      x--;
      y--;
    }
    rev[--rp] = kind;
    x = prevX;
    y = prevY;
  }
  while (x > 0) {
    rev[--rp] = KEEP;
    x--;
    y--;
  }
  return rev.subarray(rp);
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff-speed: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Cut each text after every "\n"; a last line with no "\n" is a line
  // too, and the empty text has no lines. Line i of a text ends with
  // "\n" exactly when i is before its parts' last entry.
  const aParts = oldText.split('\n');
  const bParts = newText.split('\n');
  const aLast = aParts.length - 1;
  const bLast = bParts.length - 1;
  const n = aParts[aLast] === '' ? aLast : aLast + 1;
  const m = bParts[bLast] === '' ? bLast : bLast + 1;

  // The common prefix, then the common suffix of what is left. Two
  // lines are equal only when their text and their trailing newline
  // agree, so the comparison checks both.
  let prefix = 0;
  const preMax = n < m ? n : m;
  while (prefix < preMax) {
    if (aParts[prefix] !== bParts[prefix]) break;
    if ((prefix < aLast) !== (prefix < bLast)) break;
    prefix++;
  }
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix) {
    const ai = n - 1 - suffix;
    const bi = m - 1 - suffix;
    if (aParts[ai] !== bParts[bi]) break;
    if ((ai < aLast) !== (bi < bLast)) break;
    suffix++;
  }

  // Intern the lines between prefix and suffix to small integers, one
  // Map shared by both texts so equal lines share a code. A code packs
  // the line's content id and whether it ends with "\n".
  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;
  const ids = new Map();
  let nextId = 0;
  const A = new Int32Array(midN);
  for (let i = 0; i < midN; i++) {
    const gi = prefix + i;
    const s = aParts[gi];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    A[i] = (id << 1) | (gi < aLast ? 1 : 0);
  }
  const B = new Int32Array(midM);
  for (let i = 0; i < midM; i++) {
    const gi = prefix + i;
    const s = bParts[gi];
    let id = ids.get(s);
    if (id === undefined) {
      id = nextId++;
      ids.set(s, id);
    }
    B[i] = (id << 1) | (gi < bLast ? 1 : 0);
  }

  const ops = myersOps(A, B, midN, midM);

  // Merge the ops into runs, with the kept prefix and suffix as runs.
  const runKinds = [];
  const runCounts = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runKinds.length - 1;
    if (last >= 0 && runKinds[last] === kind) {
      runCounts[last] += count;
    } else {
      runKinds.push(kind);
      runCounts.push(count);
    }
  };
  pushRun(KEEP, prefix);
  for (let i = 0; i < ops.length;) {
    const kind = ops[i];
    let j = i + 1;
    while (j < ops.length && ops[j] === kind) j++;
    pushRun(kind, j - i);
    i = j;
  }
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between
  // two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let r = 0; r < runKinds.length; r++) {
    const kind = runKinds[r];
    const count = runCounts[r];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  // Write the patch. A line that ends its text with no newline is
  // written with one and followed by a line "%".
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      while (at < c.o) {
        out.push('=', aParts[at], at < aLast ? '\n' : '\n%\n');
        at++;
      }
      for (let i = 0; i < c.dels; i++) {
        const gi = c.o + i;
        out.push('-', aParts[gi], gi < aLast ? '\n' : '\n%\n');
      }
      for (let i = 0; i < c.ins; i++) {
        const gi = c.p + i;
        out.push('+', bParts[gi], gi < bLast ? '\n' : '\n%\n');
      }
      at = c.o + c.dels;
    }
    while (at < oldEnd) {
      out.push('=', aParts[at], at < aLast ? '\n' : '\n%\n');
      at++;
    }
  }
  return out.join('');
}
