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
  return mergeAutofill(IMPORT_FIELDS, current, autofilled, incoming);
}

export interface AutofillMerge<F extends string> {
  updates: Partial<Record<F, string>>;
  autofilled: Partial<Record<F, string>>;
  conflicts: { field: F; current: string; incoming: string }[];
}

/** The same no-clobber rule for any set of text fields (also used for country / region / city). */
export function mergeAutofill<F extends string>(
  fields: readonly F[],
  current: Record<F, string>,
  autofilled: Partial<Record<F, string>>,
  incoming: Partial<Record<F, string | null>>,
): AutofillMerge<F> {
  const updates: Partial<Record<F, string>> = {};
  const nextAutofilled: Partial<Record<F, string>> = { ...autofilled };
  const conflicts: { field: F; current: string; incoming: string }[] = [];
  for (const field of fields) {
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
