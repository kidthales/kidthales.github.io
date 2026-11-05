# Security Policy

## Supported Versions

Only the active branches and deployment lines receive security patches and vulnerability assessments.

| Branch / Line | Supported          |
| :------------ | :----------------: |
| `next`        | :white_check_mark: |
| `main`        | :white_check_mark: |

## Response SLA

The maintenance team is committed to prompt vulnerability handling under the following Service Level Agreement (SLA):

- **Initial Acknowledgment**: Within **48 hours** of receiving a report.
- **Triage & Severity Assessment**: Within **5 business days**, including CVSS / CWE classification and confirmation of reproducibility.
- **Target Resolution Timeline**:
  - **Critical & High Severity**: Coordinated fix and patch release within **14 calendar days**.
  - **Medium & Low Severity**: Remediated in the next scheduled minor/patch release cycle (within **30 calendar days**).

## Scope

### In Scope
- Cross-Site Scripting (XSS), Content Security Policy (CSP) bypasses, or DOM-based injection vulnerabilities in site pages or client scripts.
- Vulnerabilities or information leaks in GitHub Actions CI/CD workflows and automated scripts.
- Integrity discrepancies in published static assets, sitemaps, or cryptographic hashes.
- Insecure defaults or secret exposure in repository source files or public distribution artifacts.

### Out of Scope
- Denial of Service attacks targeting public hosting infrastructure (GitHub Pages, GitHub Actions, unpkg, Cloudflare).
- Social engineering attacks or physical access to maintainer devices.
- Native browser rendering bugs or OS-level accessibility quirks outside web standards boundaries.
- Downstream third-party packages or services not maintained within this repository.

## Reporting a Vulnerability

### Preferred Channel: GitHub Private Vulnerability Reporting
Please report security vulnerabilities privately via GitHub Security Advisories:
👉 **[Report a vulnerability via GitHub Advisory](https://github.com/kidthales/kidthales.github.io/security/advisories/new)**

Do **not** open public GitHub issues or discussions for undisclosed security vulnerabilities.

### Fallback Contact
If you cannot use GitHub Security Advisories or need to reach maintainers directly, email our contact:
- **Email**: [admin@agogpixel.com](mailto:admin@agogpixel.com)

Please include:
1. A clear description of the vulnerability and potential impact.
2. Step-by-step instructions or minimal proof-of-concept markup to reproduce the issue.
3. Affected branches or commit SHAs.
4. Any potential mitigations or remediation patches you have identified.

### Coordinated Disclosure
We practice coordinated vulnerability disclosure. We ask reporters to allow us up to 90 days or until a patch release is published before publicly disclosing vulnerability details. We will credit reporters in our release notes and GitHub Advisories unless anonymity is requested.
