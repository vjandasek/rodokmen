import './fonts.css';

/**
 * The bundled font, Noto Sans. `family` is a full CSS font-family list (bundled face first,
 * system fallbacks after); `bold` is the weight for blood relatives and UI emphasis, `normal` for
 * partners and body text. Both weights are declared in fonts.css.
 */
export const FONT = { family: "'Noto Sans', 'Segoe UI', Roboto, Arial, sans-serif", bold: 700, normal: 400 };

/**
 * Sample covering both unicode-range subsets (Latin + Latin Extended), so the browser fetches
 * both files of a face — `document.fonts.load` only loads faces whose range covers the given text.
 */
const SAMPLE = 'AaZz ÁáÉéÍíÓóÚúÝý ĚěŠšČčŘřŽžŮůĎďŤťŇň';

/** The bundled family name: the first entry of a font-family list, without quotes. */
function primaryFamily(family: string): string {
  return family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Loads the bundled font (both weights, both subsets). Resolves when loaded, or after `timeoutMs` if
 * loading fails or stalls, so the app still starts with the fallback fonts. Never rejects.
 *
 * main.ts must `await loadFonts()` before the first canvas `measureText` / layout / render:
 * names measured with a not-yet-loaded font get fallback widths, and the boxes would not fit.
 */
export async function loadFonts(timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const loading = Promise.all(
    [FONT.normal, FONT.bold].map((w) => document.fonts.load(`${w} 16px "${primaryFamily(FONT.family)}"`, SAMPLE)),
  ).then(
    () => undefined,
    (err: unknown) => console.warn('Font loading failed, using fallback fonts.', err),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Font loading timed out after ${timeoutMs} ms, using fallback fonts.`);
      resolve();
    }, timeoutMs);
  });
  await Promise.race([loading, timeout]);
  clearTimeout(timer);
}
