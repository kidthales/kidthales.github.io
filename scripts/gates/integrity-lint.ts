import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IntegrityLintResult {
  ok: boolean;
  errors: string[];
}

/**
 * 1. Released-picotol lint:
 * @kidthales/picotol spec in package.json is an exact semver (e.g. "0.4.1", NO caret ^, tilde ~, git URL, SHA, or range) on PRs targeting next/main.
 */
export function lintReleasedPicotol(packageJsonPath: string): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(packageJsonPath)) {
    return [`package.json not found at ${packageJsonPath}`];
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const picotolDep =
    pkg.dependencies?.['@kidthales/picotol'] || pkg.devDependencies?.['@kidthales/picotol'];

  if (!picotolDep) {
    errors.push('Dependency "@kidthales/picotol" is missing in package.json.');
    return errors;
  }

  // Exact semver regex: major.minor.patch (optionally with -prerelease.N, but no range chars ^, ~, >=, *, etc., no git/file/workspace)
  const exactSemverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

  if (!exactSemverRegex.test(picotolDep)) {
    errors.push(
      `@kidthales/picotol dependency spec must be an exact semver on PRs targeting next/main. Found: "${picotolDep}". Ranges (^, ~), git URIs, and wildcards are forbidden.`
    );
  }

  return errors;
}

/**
 * 2. Credits completeness:
 * Every @fontsource* dependency in package.json appears on /credits/ (or src/pages/credits.astro).
 */
export function lintCreditsCompleteness(
  packageJsonPath: string,
  creditsAstroPath: string
): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(packageJsonPath)) {
    return [`package.json not found at ${packageJsonPath}`];
  }
  if (!fs.existsSync(creditsAstroPath)) {
    return [`credits.astro not found at ${creditsAstroPath}`];
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const creditsContent = fs.readFileSync(creditsAstroPath, 'utf8');

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const fontsourceDeps = Object.keys(allDeps).filter((dep) =>
    dep.startsWith('@fontsource')
  );

  for (const dep of fontsourceDeps) {
    // Check if the package name or its primary font name is mentioned in credits
    // e.g. @fontsource-variable/atkinson-hyperlegible-next -> "atkinson-hyperlegible-next" or "Atkinson Hyperlegible Next"
    // Let's extract the package slug
    const pkgSlug = dep.replace(/^@fontsource(-variable)?\//, '');
    const cleanFontName = pkgSlug.replace(/-/g, ' ');

    const mentionsSlug = creditsContent.toLowerCase().includes(pkgSlug.toLowerCase());
    const mentionsName = creditsContent.toLowerCase().includes(cleanFontName.toLowerCase());

    if (!mentionsSlug && !mentionsName) {
      errors.push(
        `Font dependency "${dep}" is not attributed in ${creditsAstroPath}. Every @fontsource* package must appear in /credits/.`
      );
    }
  }

  return errors;
}

export function runIntegrityLints(rootDir: string): IntegrityLintResult {
  const errors: string[] = [];
  const packageJsonPath = path.join(rootDir, 'package.json');
  const creditsPath = path.join(rootDir, 'src/pages/credits.astro');

  errors.push(...lintReleasedPicotol(packageJsonPath));
  errors.push(...lintCreditsCompleteness(packageJsonPath, creditsPath));

  return {
    ok: errors.length === 0,
    errors,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rootDir = process.argv[2] || process.cwd();
  const result = runIntegrityLints(rootDir);
  if (!result.ok) {
    console.error('Integrity Lints FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log('Integrity Lints PASSED (released-picotol and credits completeness verified).');
}
