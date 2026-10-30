import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { createWordsSchema } from './lib/schema';

const isFixtures = process.env.SITE_FIXTURES === '1';
const fixturePath = process.env.WORDS_FIXTURE_PATH;
const base = isFixtures
  ? (fixturePath || './tests/fixtures/words')
  : './src/content/words';

export const collections = {
  words: defineCollection({
    loader: glob({ pattern: '**/*.md', base }),
    schema: createWordsSchema(reference),
  }),
};
