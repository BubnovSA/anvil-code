import type { FileEdit } from '@rag-system/shared';

export type ApplyResult =
  | { ok: true; result: string; tolerantEdits: number[] }
  | { ok: false; error: string };

/**
 * Apply a sequence of search/replace edits to a string. Each edit's `search`
 * MUST occur exactly once in the (current) content — zero matches or multiple
 * matches both abort the whole operation. Edits are applied in order, so each
 * one sees the result of the previous.
 *
 * Strict matching is tried first. If `search` doesn't strict-match, a
 * whitespace-tolerant fallback is attempted: any run of whitespace in `search`
 * is treated as `\s+` against the content. The replacement is still the literal
 * `replace` string — only the matched slice of the original is substituted, so
 * indentation in `replace` lands as-is. The fallback also requires uniqueness:
 * if the tolerant pattern matches multiple places, the operation aborts.
 *
 * `tolerantEdits` (0-based indices) reports which edits had to fall back, so
 * callers can surface a warning — model "minified" multi-line search blocks
 * is the dominant failure mode this lifts off.
 *
 * This remains the core safety primitive of patch-based editing: the model can
 * only change what it explicitly quotes. Code not appearing in any `search` is
 * physically preserved.
 */
export function applyEdits(content: string, edits: FileEdit[]): ApplyResult {
  if (edits.length === 0) return { ok: false, error: 'no edits provided' };

  let current = content;
  const tolerantEdits: number[] = [];

  for (let i = 0; i < edits.length; i++) {
    const { search, replace } = edits[i];

    if (search.length === 0) {
      return { ok: false, error: `edit #${i + 1}: search string is empty` };
    }

    const firstIdx = current.indexOf(search);
    if (firstIdx !== -1) {
      const lastIdx = current.lastIndexOf(search);
      if (lastIdx !== firstIdx) {
        return {
          ok: false,
          error: `edit #${i + 1}: search string is ambiguous (matches multiple places); add more surrounding context:\n${truncate(search)}`,
        };
      }
      current = current.slice(0, firstIdx) + replace + current.slice(firstIdx + search.length);
      continue;
    }

    // Strict miss. Try whitespace-tolerant fallback: collapse runs of whitespace
    // in `search` to `\s+` and look for a unique regex match.
    const tolerant = tolerantMatch(current, search);
    if (tolerant.kind === 'unique') {
      current =
        current.slice(0, tolerant.start) +
        replace +
        current.slice(tolerant.end);
      tolerantEdits.push(i);
      continue;
    }
    if (tolerant.kind === 'ambiguous') {
      return {
        ok: false,
        error: `edit #${i + 1}: search string is ambiguous under whitespace-tolerant matching (multiple places); add more surrounding context:\n${truncate(search)}`,
      };
    }

    return {
      ok: false,
      error: `edit #${i + 1}: search string not found in file:\n${truncate(search)}`,
    };
  }

  return { ok: true, result: current, tolerantEdits };
}

type TolerantOutcome =
  | { kind: 'none' }
  | { kind: 'unique'; start: number; end: number }
  | { kind: 'ambiguous' };

function tolerantMatch(content: string, search: string): TolerantOutcome {
  // Refuse whitespace-only patterns — under \s+ normalization they would match
  // virtually any gap in the file, producing garbage. This guard is intentional:
  // strict path already rejected empty search; meaningful search has non-space chars.
  if (!/\S/.test(search)) return { kind: 'none' };

  const pattern = buildTolerantPattern(search);
  const re = new RegExp(pattern, 'g');

  let first: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (first === null) {
      first = m;
    } else {
      return { kind: 'ambiguous' };
    }
    // Guard against zero-width matches sticking the cursor in place.
    if (m.index === re.lastIndex) re.lastIndex++;
  }

  if (first === null) return { kind: 'none' };
  return { kind: 'unique', start: first.index, end: first.index + first[0].length };
}

function buildTolerantPattern(search: string): string {
  // Split on runs of whitespace, escape each non-whitespace segment for regex,
  // join back with \s+. Leading/trailing whitespace in search becomes optional
  // \s* anchors so the model isn't punished for trimming.
  const segments = search.split(/\s+/);
  const escaped = segments.map(seg => (seg.length === 0 ? '' : escapeRegex(seg)));

  // Drop empty leading/trailing parts (created by leading/trailing whitespace
  // in search) — they translate to optional \s* below.
  const leading = escaped[0] === '' ? '\\s*' : '';
  const trailing = escaped[escaped.length - 1] === '' ? '\\s*' : '';
  const core = escaped.filter(s => s.length > 0).join('\\s+');

  return leading + core + trailing;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s: string): string {
  const oneLine = s.replace(/\n/g, '⏎').replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine;
}
