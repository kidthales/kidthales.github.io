import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  runWorkflowContractGate,
  validateWorkflowContent,
} from '../scripts/gates/workflow-contract.ts';

test('workflow-contract: live .github/workflows passes all checks', () => {
  const workflowsDir = path.join(process.cwd(), '.github/workflows');
  const result = runWorkflowContractGate(workflowsDir);

  assert.equal(
    result.ok,
    true,
    `Workflow contract gate failed on live files:\n${result.errors.join('\n')}`
  );
  assert.equal(result.errors.length, 0);
});

test('workflow-contract: minimal valid CI workflow passes cleanly', () => {
  const validCiYaml = `
name: CI
on:
  push:
    branches: [next, main]
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  security:
    name: Security
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          persist-credentials: false
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    name: Verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          persist-credentials: false
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Run CI
        run: ./scripts/ci-local.ps1 -CI
  notify:
    name: Notify
    needs: [security, verify]
    if: always()
    runs-on: ubuntu-latest
    env:
      WEBHOOK_URL: \${{ secrets.DISCORD_CI_WEBHOOK }}
    steps:
      - name: Send card
        run: echo "Sending notification"
`;

  const errors = validateWorkflowContent(validCiYaml, 'ci.yml');
  assert.deepEqual(errors, []);
});

test('workflow-contract: rejects missing root permissions', () => {
  const yaml = `
name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.ok(
    errors.some((e) => e.includes('root permissions block is required')),
    `Expected root permissions error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects root permissions: write-all and root write grants', () => {
  const yamlWriteAll = `
name: CI
permissions: write-all
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
`;
  const errors1 = validateWorkflowContent(yamlWriteAll, 'test.yml');
  assert.ok(
    errors1.some((e) => e.includes('root permissions: write-all is forbidden')),
    `Expected write-all error, got: ${errors1.join(', ')}`
  );

  const yamlWriteScope = `
name: CI
permissions:
  contents: write
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
`;
  const errors2 = validateWorkflowContent(yamlWriteScope, 'test.yml');
  assert.ok(
    errors2.some((e) => e.includes('root permissions must not grant write privileges')),
    `Expected write scope error, got: ${errors2.join(', ')}`
  );
});

test('workflow-contract: rejects unpinned action SHAs', () => {
  const yaml = `
name: Test
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.ok(
    errors.some((e) => e.includes('Remote actions must be pinned to a 40-character commit SHA')),
    `Expected action pin error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects actions/checkout without persist-credentials: false', () => {
  const yaml = `
name: Test
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.ok(
    errors.some((e) => e.includes('must explicitly set \'with.persist-credentials: false\'')),
    `Expected persist-credentials error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects unescaped expressions in run: steps', () => {
  const yaml = `
name: Test
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Inject
        run: echo "PR title is \${{ github.event.issue.title }}"
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.ok(
    errors.some((e) => e.includes('contains unescaped expression(s)')),
    `Expected unescaped expression error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects CI without caller-isolated concurrency', () => {
  const yaml = `
name: CI
permissions:
  contents: read
concurrency:
  group: fixed-ci-group
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/ci-local.ps1 -CI
  notify:
    needs: [security, verify]
    if: always()
    runs-on: ubuntu-latest
    env:
      WEBHOOK: \${{ secrets.DISCORD_CI_WEBHOOK }}
    steps:
      - run: echo "done"
`;
  const errors = validateWorkflowContent(yaml, 'ci.yml');
  assert.ok(
    errors.some((e) => e.includes('CI concurrency group must be caller-isolated')),
    `Expected concurrency error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects verify job missing canonical ./scripts/ci-local.ps1 -CI', () => {
  const yaml = `
name: CI
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Build only
        run: npm run build
  notify:
    needs: [security, verify]
    if: always()
    runs-on: ubuntu-latest
    env:
      WEBHOOK: \${{ secrets.DISCORD_CI_WEBHOOK }}
    steps:
      - run: echo "done"
`;
  const errors = validateWorkflowContent(yaml, 'ci.yml');
  assert.ok(
    errors.some((e) => e.includes('does not invoke canonical \'./scripts/ci-local.ps1 -CI\'')),
    `Expected missing canonical CI error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects verify job with unallowlisted run steps', () => {
  const yaml = `
name: CI
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Unauthorized custom script
        run: node scripts/custom-hack.js
      - name: Run CI
        run: ./scripts/ci-local.ps1 -CI
  notify:
    needs: [security, verify]
    if: always()
    runs-on: ubuntu-latest
    env:
      WEBHOOK: \${{ secrets.DISCORD_CI_WEBHOOK }}
    steps:
      - run: echo "done"
`;
  const errors = validateWorkflowContent(yaml, 'ci.yml');
  assert.ok(
    errors.some((e) => e.includes('is not in the exact step allowlist')),
    `Expected unallowlisted step error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects missing security job in CI', () => {
  const yaml = `
name: CI
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/ci-local.ps1 -CI
  notify:
    needs: [verify]
    if: always()
    runs-on: ubuntu-latest
    env:
      WEBHOOK: \${{ secrets.DISCORD_CI_WEBHOOK }}
    steps:
      - run: echo "done"
`;
  const errors = validateWorkflowContent(yaml, 'ci.yml');
  assert.ok(
    errors.some((e) => e.includes('must define a dedicated \'security\' job running gitleaks and zizmor')),
    `Expected missing security job error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: rejects missing notify job or missing Discord webhook reference in CI', () => {
  const yamlNoNotify = `
name: CI
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/ci-local.ps1 -CI
`;
  const errors1 = validateWorkflowContent(yamlNoNotify, 'ci.yml');
  assert.ok(
    errors1.some((e) => e.includes('must define a dedicated \'notify\' job for Discord CI notifications')),
    `Expected missing notify job error, got: ${errors1.join(', ')}`
  );

  const yamlNoWebhook = `
name: CI
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/ci-local.ps1 -CI
  notify:
    needs: [security, verify]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo "no webhook here"
`;
  const errors2 = validateWorkflowContent(yamlNoWebhook, 'ci.yml');
  assert.ok(
    errors2.some((e) => e.includes('must reference \'DISCORD_CI_WEBHOOK\'')),
    `Expected webhook reference error, got: ${errors2.join(', ')}`
  );
});

test('workflow-contract: rejects job-level unauthorized write privileges', () => {
  const yaml = `
name: Test
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: echo "write attempted"
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.ok(
    errors.some((e) => e.includes('requests elevated write privilege \'contents: write\'')),
    `Expected job write privilege error, got: ${errors.join(', ')}`
  );
});

test('workflow-contract: permits allowlisted deploy job write privileges (pages: write, id-token: write)', () => {
  const yaml = `
name: Test
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/deploy-pages@d6db9016b541285dbb1328905b739665bc837e24
`;
  const errors = validateWorkflowContent(yaml, 'test.yml');
  assert.equal(errors.length, 0);
});
