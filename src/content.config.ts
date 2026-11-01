import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { createWordsSchema } from './lib/schema';
import { createWorksSchema } from './lib/works-schema';

const isFixtures = process.env.SITE_FIXTURES === '1';

const wordsFixturePath = process.env.WORDS_FIXTURE_PATH;
const wordsBase = isFixtures
  ? (wordsFixturePath || './tests/fixtures/words')
  : './src/content/words';

const worksFixturePath = process.env.WORKS_FIXTURE_PATH;
const worksBase = isFixtures
  ? (worksFixturePath || './tests/fixtures/works')
  : './src/content/works';

export const collections = {
  words: defineCollection({
    loader: glob({ pattern: '**/*.md', base: wordsBase }),
    schema: createWordsSchema(reference),
  }),
  works: defineCollection({
    loader: glob({ pattern: '**/*.md', base: worksBase }),
    schema: createWorksSchema(),
  }),
};
