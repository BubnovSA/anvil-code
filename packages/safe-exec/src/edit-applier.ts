import type { FileEdit } from '@rag-system/shared';

export type ApplyResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

/**
 * Apply a sequence of search/replace edits to a string. Each edit's `search`
 * MUST occur exactly once in the (current) content — zero matches or multiple
 * matches both abort the whole operation. Edits are applied in order, so each
 * one sees the result of the previous.
 *
 * This is the core safety primitive of patch-based editing: the model can only
 * change what it explicitly quotes. Any code not appearing in a `search` is
 * physically preserved.
 */
export function applyEdits(content: string, edits: FileEdit[]): ApplyResult {
  if (edits.length === 0) return { ok: false, error: 'no edits provided' };

  let current = content;
  for (let i = 0; i < edits.length; i++) {
    const { search, replace } = edits[i];

    if (search.length === 0) {
      return { ok: false, error: `edit #${i + 1}: search string is empty` };
    }

    const firstIdx = current.indexOf(search);
    if (firstIdx === -1) {
      return {
        ok: false,
        error: `edit #${i + 1}: search string not found in file:\n${truncate(search)}`,
      };
    }

    const lastIdx = current.lastIndexOf(search);
    if (lastIdx !== firstIdx) {
      return {
        ok: false,
        error: `edit #${i + 1}: search string is ambiguous (matches multiple places); add more surrounding context:\n${truncate(search)}`,
      };
    }

    current = current.slice(0, firstIdx) + replace + current.slice(firstIdx + search.length);
  }

  return { ok: true, result: current };
}

function truncate(s: string): string {
  const oneLine = s.replace(/\n/g, '⏎').replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine;
}
