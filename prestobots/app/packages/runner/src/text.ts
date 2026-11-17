/** Lower-case, no accents, single spaces. "¿Querés CANCELAR?" → "¿queres cancelar?" */
export const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const includesNormalized = (haystack: string, needle: string): boolean =>
  normalizeText(haystack).includes(normalizeText(needle));

/** Resolves after `ms`, or rejects with an AbortError if the signal fires first. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const abortError = (): Error => {
  const error = new Error('The run was cancelled');
  error.name = 'AbortError';
  return error;
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';
