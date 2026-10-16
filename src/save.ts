/**
 * "Uložit data" (developer mode): the edited family file saved as a new JSON file the user picks.
 * Never overwrites anything by itself: the browser's save dialog always asks.
 */
import { savedFileName, serialize, type FamilyEditor } from './edit.ts';

/** The part of the File System Access API used here (not in TypeScript's DOM types everywhere). */
interface SaveFilePickerOptions {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<{ createWritable(): Promise<WritableFile> }>;

/**
 * Asks where to save and writes the data; true when saved (and the editor marked saved), false
 * when the user cancelled. Browsers without a save dialog API download the file instead.
 */
export async function saveFamily(editor: FamilyEditor): Promise<boolean> {
  const text = serialize(editor.file);
  const name = savedFileName(new Date());
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    download(text, name);
    editor.markSaved();
    return true;
  }
  let handle;
  try {
    // The id makes Chrome open the dialog in the folder used last time (FamTreeWeb/data).
    handle = await picker({
      id: 'famtree-data',
      suggestedName: name,
      types: [{ description: 'Data rodokmenu', accept: { 'application/json': ['.json'] } }],
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    throw e;
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  editor.markSaved();
  return true;
}

/** Fallback: the browser's ordinary download of a file. */
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
