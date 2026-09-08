/**
 * Turning whatever was thrown into something a person can read.
 *
 * Supabase rejects with a plain object carrying `message`, `details`, `hint`
 * and `code` -- not an Error. Passing that to String() yields the useless
 * "[object Object]", which is exactly what a failed share reported before this
 * existed. Anything shown to someone standing at a bar has to say what went
 * wrong, or it may as well say nothing.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const shaped = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    const parts = [shaped.message, shaped.details, shaped.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '');

    if (parts.length > 0) {
      const code = typeof shaped.code === 'string' ? ` (${shaped.code})` : '';
      return parts.join(' — ') + code;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Onbekende fout.';
    }
  }

  return String(error);
}
