# kidthales.github.io (frozen)

> **This repository is frozen.** It currently serves <https://kidthales.com> and must not change until the planned replacement is cut over.
>
> The successor is [`kidthales/kidthales-site`](https://github.com/kidthales/kidthales-site) (see its epic for the plan and the gated cutover ticket).

## Production gate

- Production is served by GitHub Pages from the `live` branch, which is written by the `CD` workflow on every push to `main`.
- `main` and `live` are protected by a ruleset: changes require a pull request and direct pushes are blocked for everyone except repository admins.
- Because a push to `main` triggers a production deploy, documentation-only commits must include `[skip ci]` in the commit message.
- Dependency bumps and content changes are intentionally not made here; they happen in the successor repository.
