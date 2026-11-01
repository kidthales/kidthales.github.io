import type { CollectionEntry } from 'astro:content';
import {
  type WorkKind,
  validateWorkSlugs,
} from './works-schema.ts';

export type WorkEntry = CollectionEntry<'works'>;

export const KIND_LABELS: Record<WorkKind, string> = {
  tool: 'Tool',
  app: 'App',
  game: 'Game',
};

export const KIND_GLYPHS: Record<WorkKind, string> = {
  tool: '🛠',
  app: '◈',
  game: '🎮',
};

export function isRetired(work: { data: { retired_on?: Date } }): boolean {
  return Boolean(work.data.retired_on);
}

/**
 * Retrieves all Works entries and validates slugs against grammar and reserved routes.
 */
export async function getAllWorks(): Promise<WorkEntry[]> {
  const { getCollection } = await import('astro:content');
  const works = await getCollection('works');
  validateWorkSlugs(works);
  return works;
}

/**
 * Returns all published works (draft !== true), including both active and retired,
 * sorted newest first by published_on.
 */
export async function getPublishedWorks(): Promise<WorkEntry[]> {
  const all = await getAllWorks();
  const published = all.filter((work) => work.data.draft !== true);

  return published.sort((a, b) => {
    const timeA = a.data.published_on ? new Date(a.data.published_on).getTime() : 0;
    const timeB = b.data.published_on ? new Date(b.data.published_on).getTime() : 0;
    return timeB - timeA;
  });
}

/**
 * Returns all active (published and non-retired) works, sorted newest first.
 */
export async function getActivePublishedWorks(): Promise<WorkEntry[]> {
  const published = await getPublishedWorks();
  return published.filter((work) => !isRetired(work));
}

/**
 * Returns up to N latest active published works.
 */
export async function getLatestPublishedWorks(limit: number = 5): Promise<WorkEntry[]> {
  const active = await getActivePublishedWorks();
  return active.slice(0, limit);
}

export function formatDate(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}
