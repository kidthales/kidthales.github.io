export interface WorksIslandOrigin {
  origin: string;
  reason: string;
}

export interface WorksIsland {
  route: string;
  reason: string;
  js: boolean;
  origins: WorksIslandOrigin[];
}

export interface ManifestValidationError {
  route: string;
  error: string;
}

export function validateManifest(manifest: WorksIsland[]): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  const seenRoutes = new Set<string>();

  for (const item of manifest) {
    if (!item.route) {
      errors.push({ route: '', error: 'Route must be a non-empty string' });
      continue;
    }

    if (seenRoutes.has(item.route)) {
      errors.push({ route: item.route, error: `Duplicate route declared in manifest: ${item.route}` });
    }
    seenRoutes.add(item.route);

    // non-/works/** routes fail
    if (!item.route.startsWith('/works/')) {
      errors.push({
        route: item.route,
        error: `Route "${item.route}" must be under /works/**. Client JS/origins outside /works/** are strictly forbidden.`,
      });
    }

    // validate origins
    if (Array.isArray(item.origins)) {
      for (const orig of item.origins) {
        if (!orig.origin || typeof orig.origin !== 'string') {
          errors.push({ route: item.route, error: 'Origin entry must specify a non-empty origin string' });
        } else {
          try {
            const parsed = new URL(orig.origin);
            if (!parsed.protocol.startsWith('http')) {
              errors.push({ route: item.route, error: `Origin "${orig.origin}" has unsupported protocol` });
            }
          } catch {
            errors.push({ route: item.route, error: `Invalid origin URL: "${orig.origin}"` });
          }
        }
      }
    }
  }

  return errors;
}
