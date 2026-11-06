import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export interface WorkflowContractResult {
  ok: boolean;
  errors: string[];
}

export const CANONICAL_CI_RUNS: ReadonlySet<string> = new Set([
  './scripts/ci-local.ps1 -CI',
  'pwsh ./scripts/ci-local.ps1 -CI',
  'pwsh -File ./scripts/ci-local.ps1 -CI',
]);

export const EXACT_STEP_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ['verify/Install dependencies', 'npm ci'],
  ['verify/Install Playwright browsers', 'npx playwright install chromium --only-shell'],
]);

export function validateWorkflowContent(
  yamlContent: string,
  fileName = 'workflow.yml'
): string[] {
  const errors: string[] = [];

  const doc = parseDocument(yamlContent);
  if (doc.errors.length > 0) {
    return doc.errors.map(
      (e) => `${fileName}: YAML parse error at line ${e.linePos?.[0]?.line ?? '?'}: ${e.message}`
    );
  }

  const data = doc.toJS();
  if (!data || typeof data !== 'object') {
    return [`${fileName}: workflow file is empty or not a valid YAML object.`];
  }

  // 1. Root permissions check
  const permissions = data.permissions;
  if (!permissions) {
    errors.push(
      `${fileName}: root permissions block is required and must enforce least-privilege (contents: read).`
    );
  } else if (permissions === 'write-all') {
    errors.push(`${fileName}: root permissions: write-all is forbidden.`);
  } else if (typeof permissions === 'string') {
    if (permissions !== 'read-all') {
      errors.push(
        `${fileName}: root permissions string '${permissions}' is not allowed; must be { contents: read } or read-all.`
      );
    }
  } else if (typeof permissions === 'object') {
    if (permissions.contents !== 'read') {
      errors.push(
        `${fileName}: root permissions must specify 'contents: read'. Found: ${JSON.stringify(permissions.contents)}.`
      );
    }
    for (const [scope, level] of Object.entries(permissions)) {
      if (level === 'write') {
        errors.push(
          `${fileName}: root permissions must not grant write privileges. Found '${scope}: write'. Use job-level permissions instead.`
        );
      }
    }
  } else {
    errors.push(`${fileName}: root permissions must be a mapping { contents: read }.`);
  }

  // 2. Jobs check
  const jobs = data.jobs;
  if (!jobs || typeof jobs !== 'object') {
    errors.push(`${fileName}: workflow must define a 'jobs' object.`);
    return errors;
  }

  const isCiWorkflow =
    fileName.endsWith('ci.yml') ||
    fileName.endsWith('ci.yaml') ||
    data.name === 'CI';

  // 3. Concurrency check for CI
  if (isCiWorkflow) {
    const concurrency = data.concurrency;
    if (!concurrency) {
      errors.push(
        `${fileName}: CI workflow must define caller-isolated concurrency: group: \${{ github.workflow }}-\${{ github.ref }}.`
      );
    } else {
      const groupStr =
        typeof concurrency === 'string'
          ? concurrency
          : typeof concurrency.group === 'string'
            ? concurrency.group
            : '';
      if (!groupStr.includes('github.workflow') || !groupStr.includes('github.ref')) {
        errors.push(
          `${fileName}: CI concurrency group must be caller-isolated containing \${{ github.workflow }}-\${{ github.ref }}. Found: '${groupStr}'.`
        );
      }
    }
  }

  // Inspect each job
  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw as Record<string, any>;
    if (!job || typeof job !== 'object') {
      continue;
    }

    // Job permissions check
    const jobPerms = job.permissions;
    if (jobPerms === 'write-all') {
      errors.push(`${fileName}: job '${jobId}' specifies 'permissions: write-all' which is forbidden.`);
    } else if (typeof jobPerms === 'object' && jobPerms !== null) {
      for (const [scope, level] of Object.entries(jobPerms)) {
        if (level === 'write') {
          // Security job security-events write and deploy job pages/id-token write are allowlisted
          if (jobId === 'security' && scope === 'security-events') {
            continue;
          }
          if (jobId === 'deploy' && (scope === 'pages' || scope === 'id-token')) {
            continue;
          }
          errors.push(
            `${fileName}: job '${jobId}' requests elevated write privilege '${scope}: write' violating least-privilege.`
          );
        }
      }
    }

    const steps = job.steps;
    if (!Array.isArray(steps)) {
      if (!job.uses) {
        errors.push(`${fileName}: job '${jobId}' has no steps.`);
      }
      continue;
    }

    let jobRunsCanonicalCi = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as Record<string, any>;
      if (!step || typeof step !== 'object') {
        continue;
      }

      const stepName = step.name || `step[${i}]`;

      // 40-char SHA pin check & persist-credentials check on uses:
      if (typeof step.uses === 'string') {
        const rawUses = step.uses.trim();
        const usesTarget = rawUses.split('#')[0].trim();

        if (
          !usesTarget.startsWith('./') &&
          !usesTarget.startsWith('../') &&
          !usesTarget.startsWith('docker://')
        ) {
          const atIdx = usesTarget.lastIndexOf('@');
          if (atIdx === -1) {
            errors.push(
              `${fileName}: job '${jobId}' step '${stepName}' uses action '${usesTarget}' without ref/SHA.`
            );
          } else {
            const ref = usesTarget.slice(atIdx + 1);
            if (!/^[0-9a-fA-F]{40}$/.test(ref)) {
              errors.push(
                `${fileName}: job '${jobId}' step '${stepName}' uses unpinned action '${usesTarget}'. Remote actions must be pinned to a 40-character commit SHA.`
              );
            }
          }
        }

        // Checkout persist-credentials: false
        if (usesTarget.startsWith('actions/checkout@')) {
          const persistCreds = step.with?.['persist-credentials'];
          if (persistCreds !== false && persistCreds !== 'false') {
            errors.push(
              `${fileName}: job '${jobId}' checkout step '${stepName}' must explicitly set 'with.persist-credentials: false'.`
            );
          }
        }
      }

      // Zero unescaped ${{ ... }} expressions in run:
      if (typeof step.run === 'string') {
        const runStr = step.run;
        const matches = runStr.match(/\$\{\{[\s\S]*?\}\}/g);
        if (matches && matches.length > 0) {
          errors.push(
            `${fileName}: job '${jobId}' step '${stepName}' contains unescaped expression(s) ${matches.map((m) => `'${m}'`).join(', ')} in 'run:'. Map expressions to 'env:' variables instead.`
          );
        }

        // Canonical CI check & exact allowlist check
        const trimmedRun = runStr.trim();
        const isCanonicalCi = CANONICAL_CI_RUNS.has(trimmedRun);
        if (isCanonicalCi) {
          jobRunsCanonicalCi = true;
        }

        if (isCiWorkflow && (jobId === 'verify' || jobId === 'test-and-build')) {
          const pairKey = `${jobId}/${stepName}`;
          const allowlistedCmd = EXACT_STEP_ALLOWLIST.get(pairKey);
          const isAllowlisted = allowlistedCmd !== undefined && trimmedRun === allowlistedCmd;

          if (!isCanonicalCi && !isAllowlisted) {
            errors.push(
              `${fileName}: job '${jobId}' step '${stepName}' runs script ('${trimmedRun}') instead of canonical './scripts/ci-local.ps1 -CI' and pair '${pairKey}' is not in the exact step allowlist.`
            );
          }
        }
      }
    }

    if (isCiWorkflow && (jobId === 'verify' || jobId === 'test-and-build')) {
      if (!jobRunsCanonicalCi) {
        errors.push(
          `${fileName}: verify job '${jobId}' defines steps but does not invoke canonical './scripts/ci-local.ps1 -CI'.`
        );
      }
    }
  }

  // Workflow-level checks for CI
  if (isCiWorkflow) {
    // Dedicated security job
    const secJob = jobs.security as Record<string, any> | undefined;
    if (!secJob) {
      errors.push(
        `${fileName}: must define a dedicated 'security' job running gitleaks and zizmor.`
      );
    } else {
      const secSteps = Array.isArray(secJob.steps) ? secJob.steps : [];
      const hasGitleaks = secSteps.some(
        (s: any) => typeof s?.uses === 'string' && s.uses.includes('gitleaks/gitleaks-action@')
      );
      const hasZizmor = secSteps.some(
        (s: any) => typeof s?.uses === 'string' && s.uses.includes('zizmorcore/zizmor-action@')
      );

      if (!hasGitleaks) {
        errors.push(
          `${fileName}: 'security' job must include a step running 'gitleaks/gitleaks-action'.`
        );
      }
      if (!hasZizmor) {
        errors.push(
          `${fileName}: 'security' job must include a step running 'zizmorcore/zizmor-action'.`
        );
      }
    }

    // Dedicated notify job
    const notifyJob = jobs.notify as Record<string, any> | undefined;
    if (!notifyJob) {
      errors.push(
        `${fileName}: must define a dedicated 'notify' job for Discord CI notifications.`
      );
    } else {
      const needs = notifyJob.needs;
      const needsArr = Array.isArray(needs) ? needs : typeof needs === 'string' ? [needs] : [];
      if (!needsArr.includes('security') || !needsArr.includes('verify')) {
        errors.push(
          `${fileName}: 'notify' job must declare 'needs: [security, verify]'. Found: ${JSON.stringify(needs)}.`
        );
      }

      const ifCond = String(notifyJob.if || '');
      if (!ifCond.includes('always()')) {
        errors.push(
          `${fileName}: 'notify' job must run on condition 'always()'. Found: '${ifCond}'.`
        );
      }

      const envStr = JSON.stringify(notifyJob.env || {});
      const stepsStr = JSON.stringify(notifyJob.steps || []);
      if (!envStr.includes('DISCORD_CI_WEBHOOK') && !stepsStr.includes('DISCORD_CI_WEBHOOK')) {
        errors.push(
          `${fileName}: 'notify' job must reference 'DISCORD_CI_WEBHOOK' for alert dispatching.`
        );
      }
    }
  }

  return errors;
}

export function validateWorkflowFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [`Workflow file not found: ${filePath}`];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return validateWorkflowContent(content, path.basename(filePath));
}

export function runWorkflowContractGate(workflowsDir: string): WorkflowContractResult {
  if (!fs.existsSync(workflowsDir)) {
    return {
      ok: false,
      errors: [`Workflows directory not found: ${workflowsDir}`],
    };
  }

  const entries = fs.readdirSync(workflowsDir);
  const wfFiles = entries.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  if (wfFiles.length === 0) {
    return {
      ok: false,
      errors: [`No workflow files (*.yml, *.yaml) found in ${workflowsDir}`],
    };
  }

  const errors: string[] = [];
  for (const wf of wfFiles) {
    const fullPath = path.join(workflowsDir, wf);
    const fileErrors = validateWorkflowFile(fullPath);
    errors.push(...fileErrors);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const targetDir = process.argv[2] || path.join(process.cwd(), '.github/workflows');
  const result = runWorkflowContractGate(targetDir);

  if (!result.ok) {
    console.error('Workflow Contract Gate FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('Workflow Contract Gate PASSED: all workflows satisfy AST contract.');
}
