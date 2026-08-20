import { deserialize, type Store, serialize } from 'windease';
import type { TubeSpec } from '../../../src/render/tube/index.js';

const KEY = 'tube-lab/v1';

interface Saved {
  layout: unknown;
  letters: string;
  spec: TubeSpec;
}

export function save(store: Store, letters: string, spec: TubeSpec): void {
  const saved: Saved = { layout: serialize(store), letters, spec };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // A full or blocked localStorage costs the arrangement, not the session.
  }
}

/** Hydrates `store` in place and returns what else was saved, or null on anything unreadable. */
export function restore(store: Store): { letters: string; spec: TubeSpec } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Saved;
    deserialize(store, saved.layout);
    return { letters: saved.letters, spec: saved.spec };
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}

export function clear(): void {
  localStorage.removeItem(KEY);
}
