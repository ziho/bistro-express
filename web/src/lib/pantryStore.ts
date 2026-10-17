import { useMemo, useSyncExternalStore } from 'react';
import {
  addToPantry,
  clearPantry,
  EMPTY_PANTRY,
  PANTRY_STORAGE_KEY,
  pantryKeySet,
  readPantry,
  removeFromPantry,
  serializePantry,
  type Pantry,
  type PantryAddResult,
} from '../../../shared/pantry';

/**
 * ok = saved on this device; blocked = storage unavailable or full, the list only lives in this
 * tab until it is closed; corrupt = the saved data could not be read, shown as an empty list until
 * the next change overwrites it.
 */
export type PantryStorageState = 'ok' | 'blocked' | 'corrupt';

export interface PantrySnapshot {
  pantry: Pantry;
  storage: PantryStorageState;
}

export interface PantryStoreDeps {
  storage: () => Storage | null;
  now: () => Date;
}

/**
 * One shared, immutable snapshot of the remembered ingredients for every consumer (finder, draft
 * preview, saved list). Changes notify subscribers in this window immediately; other tabs pick
 * them up through the `storage` event (see `handleStorageEvent`).
 */
export function createPantryStore(deps: PantryStoreDeps) {
  const listeners = new Set<() => void>();

  function load(): PantrySnapshot {
    try {
      const storage = deps.storage();
      if (!storage) return { pantry: EMPTY_PANTRY, storage: 'blocked' };
      const read = readPantry(storage.getItem(PANTRY_STORAGE_KEY));
      return { pantry: read.pantry, storage: read.status === 'corrupt' ? 'corrupt' : 'ok' };
    } catch {
      return { pantry: EMPTY_PANTRY, storage: 'blocked' };
    }
  }

  let snapshot = load();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Saves `next`; when storage refuses, the list still works in memory and the snapshot says so. */
  function commit(next: Pantry): void {
    let storage: PantryStorageState = 'ok';
    try {
      const s = deps.storage();
      if (!s) throw new Error('storage unavailable');
      s.setItem(PANTRY_STORAGE_KEY, serializePantry(next));
    } catch {
      storage = 'blocked';
    }
    snapshot = { pantry: next, storage };
    emit();
  }

  /** Another tab changed storage: re-read it. A blocked read keeps this tab's in-memory list. */
  function reload(): void {
    const loaded = load();
    if (loaded.storage === 'blocked') return;
    snapshot = loaded;
    emit();
  }

  return {
    getSnapshot: (): PantrySnapshot => snapshot,

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reload,

    /** `key` is StorageEvent.key: null means the whole storage was cleared. */
    handleStorageEvent: (key: string | null): void => {
      if (key === null || key === PANTRY_STORAGE_KEY) reload();
    },

    /** Local data was wiped (logout): forget everything, including an in-memory-only list. */
    reset: (): void => {
      snapshot = load();
      emit();
    },

    add: (text: string): PantryAddResult => {
      const result = addToPantry(snapshot.pantry, text, deps.now());
      if (result.added.length) commit(result.pantry);
      return result;
    },

    remove: (name: string): void => {
      const next = removeFromPantry(snapshot.pantry, name, deps.now());
      if (next !== snapshot.pantry) commit(next);
    },

    clear: (): void => {
      commit(clearPantry(deps.now()));
    },
  };
}

export type PantryStore = ReturnType<typeof createPantryStore>;

let shared: PantryStore | null = null;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The app-wide store, created on first use (keeps tests and module evaluation free of side effects). */
export function pantryStore(): PantryStore {
  if (!shared) {
    const store = createPantryStore({ storage: browserStorage, now: () => new Date() });
    window.addEventListener('storage', (e) => {
      if (e.storageArea === null || e.storageArea === browserStorage()) store.handleStorageEvent(e.key);
    });
    shared = store;
  }
  return shared;
}

/** The remembered ingredients plus their match keys (aliases folded), shared by every consumer. */
export function usePantry() {
  const store = pantryStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const keys = useMemo(() => pantryKeySet(snap.pantry.names), [snap.pantry]);
  return { ...snap, keys, add: store.add, remove: store.remove, clear: store.clear };
}
