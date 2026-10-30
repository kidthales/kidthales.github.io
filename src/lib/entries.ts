import type { CollectionEntry } from 'astro:content';

export type WordEntry = CollectionEntry<'words'>;

export interface ValidationEntry {
  id: string;
  data: {
    title: string;
    draft?: boolean;
    published_on?: Date;
    withdrawn_on?: Date;
    superseded_by?: unknown;
    errata?: Array<{ on: Date; class: 'typo' | 'correction' | 'clarification'; note: string }>;
  };
}

/**
 * Validates superseded_by references in the given entries:
 * 1. Build throws if target does not exist.
 * 2. Build throws if target is not Published (is a draft or is withdrawn).
 * 3. Build throws on supersede cycles (e.g. A -> B -> A).
 */
export function validateSupersededBy<T extends ValidationEntry>(entries: T[]): void {
  const entryMap = new Map<string, T>();
  for (const entry of entries) {
    entryMap.set(entry.id, entry);
  }

  for (const entry of entries) {
    if (!entry.data.superseded_by) {
      continue;
    }

    const rawTarget = entry.data.superseded_by;
    const targetId =
      typeof rawTarget === 'object' && rawTarget !== null && 'id' in rawTarget
        ? String((rawTarget as { id: unknown }).id)
        : String(rawTarget);

    const target = entryMap.get(targetId);
    if (!target) {
      throw new Error(
        `Dangling reference: Entry '${entry.id}' has superseded_by '${targetId}', but '${targetId}' does not exist.`
      );
    }

    if (target.data.draft === true) {
      throw new Error(
        `Invalid supersede target: Entry '${entry.id}' has superseded_by '${targetId}', but target is a draft.`
      );
    }

    if (target.data.withdrawn_on) {
      throw new Error(
        `Invalid supersede target: Entry '${entry.id}' has superseded_by '${targetId}', but target is withdrawn.`
      );
    }

    // Cycle detection
    const chain = [entry.id, target.id];
    const visited = new Set<string>(chain);
    let curr = target;
    while (curr && curr.data.superseded_by) {
      const nextRaw = curr.data.superseded_by;
      const nextId =
        typeof nextRaw === 'object' && nextRaw !== null && 'id' in nextRaw
          ? String((nextRaw as { id: unknown }).id)
          : String(nextRaw);

      chain.push(nextId);
      if (visited.has(nextId)) {
        throw new Error(`Supersede cycle detected: ${chain.join(' -> ')}`);
      }
      visited.add(nextId);
      const nextTarget = entryMap.get(nextId);
      if (!nextTarget) {
        break;
      }
      curr = nextTarget;
    }
  }
}

/**
 * Retrieves all Word entries and runs cross-entry validation.
 */
export async function getAllEntries(): Promise<WordEntry[]> {
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('words');
  validateSupersededBy(entries);
  return entries;
}

/**
 * Returns all published entries (excluding drafts and Withdrawn), sorted newest first by published_on.
 */
export async function getPublishedEntries(): Promise<WordEntry[]> {
  const all = await getAllEntries();
  const published = all.filter((entry) => entry.data.draft !== true && !entry.data.withdrawn_on);

  return published.sort((a, b) => {
    const timeA = a.data.published_on ? new Date(a.data.published_on).getTime() : 0;
    const timeB = b.data.published_on ? new Date(b.data.published_on).getTime() : 0;
    return timeB - timeA;
  });
}

/**
 * Returns latest N published entries.
 */
export async function getLatestPublishedEntries(limit: number = 5): Promise<WordEntry[]> {
  const published = await getPublishedEntries();
  return published.slice(0, limit);
}

export function isSuperseded(entry: WordEntry | ValidationEntry): boolean {
  return Boolean(entry.data.superseded_by);
}

export function isCorrected(entry: WordEntry | ValidationEntry): boolean {
  return Boolean(entry.data.errata && entry.data.errata.some((e) => e.class === 'correction'));
}
