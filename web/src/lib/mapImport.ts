/** Restaurant form fields the map-link importer may fill. Everything else stays manual. */
export type ImportField = 'name' | 'mapUrl';
export const IMPORT_FIELDS: ImportField[] = ['name', 'mapUrl'];

export type ImportValues = Record<ImportField, string>;

export interface ImportConflict {
  field: ImportField;
  current: string;
  incoming: string;
}

export interface ImportMerge {
  /** Field values to write into the form. */
  updates: Partial<ImportValues>;
  /** What the importer has written so far (to recognise untouched auto-filled values later). */
  autofilled: Partial<ImportValues>;
  /** Fields the user edited themselves: only replaced after an explicit confirmation. */
  conflicts: ImportConflict[];
}

/**
 * Merge a resolved link into the form without clobbering the user's own typing:
 * a field is filled when it is empty or still holds the value the importer put there earlier.
 * Missing incoming values never clear anything.
 */
export function mergeImport(
  current: ImportValues,
  autofilled: Partial<ImportValues>,
  incoming: Partial<Record<ImportField, string | null>>,
): ImportMerge {
  const updates: Partial<ImportValues> = {};
  const nextAutofilled: Partial<ImportValues> = { ...autofilled };
  const conflicts: ImportConflict[] = [];
  for (const field of IMPORT_FIELDS) {
    const value = incoming[field]?.trim();
    if (!value) continue;
    const now = current[field].trim();
    if (now === value) {
      nextAutofilled[field] = value;
    } else if (!now || now === autofilled[field]) {
      updates[field] = value;
      nextAutofilled[field] = value;
    } else {
      conflicts.push({ field, current: now, incoming: value });
    }
  }
  return { updates, autofilled: nextAutofilled, conflicts };
}
