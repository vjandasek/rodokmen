/**
 * The published site carries the family data encrypted in the page (scripts/publish.ts). Before
 * anything is shown the visitor types the family password; the key can be remembered on the
 * device, so the next visits open straight away until the password changes.
 */
import type { FamilyFile } from './model.ts';
import { exportKey, importKey, open, vaultKey, type Vault } from './vault.ts';

/** Where a remembered key is kept (this site's local storage only). */
const KEY_STORAGE = 'rodokmen-key';

/** The encrypted data embedded by the publish script, or null in development and local builds. */
export function embeddedVault(): Vault | null {
  const text = document.getElementById('family-vault')?.textContent;
  return text ? (JSON.parse(text) as Vault) : null;
}

function rememberedKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

function remember(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Private windows may refuse storage: the password is then asked next time again.
  }
}

/**
 * The decrypted family: with the remembered key when it still fits, otherwise after the visitor
 * types the right password into `form` (shown only then, hidden again before resolving).
 */
export async function unlockFamily(vault: Vault, form: HTMLFormElement): Promise<FamilyFile> {
  const saved = rememberedKey();
  if (saved) {
    try {
      return JSON.parse(await open(vault, await importKey(saved))) as FamilyFile;
    } catch {
      // A new password since the last visit: ask again.
      remember(null);
    }
  }

  const input = form.querySelector<HTMLInputElement>('#unlock-password')!;
  const show = form.querySelector<HTMLInputElement>('#unlock-show')!;
  const keep = form.querySelector<HTMLInputElement>('#unlock-remember')!;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = form.querySelector<HTMLElement>('#unlock-error')!;
  form.hidden = false;
  input.focus();
  show.addEventListener('change', () => (input.type = show.checked ? 'text' : 'password'));

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (button.disabled || !input.value.trim()) return;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Otevírám…';
      error.hidden = true;
      try {
        const key = await vaultKey(vault, input.value);
        const file = JSON.parse(await open(vault, key)) as FamilyFile;
        remember(keep.checked ? await exportKey(key) : null);
        form.hidden = true;
        resolve(file);
      } catch {
        error.textContent = 'Heslo nesouhlasí. Zkuste ho napsat znovu.';
        error.hidden = false;
        input.select();
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
  });
}
