<p align="center">
  <picture>
    <img alt="Inactivity Lock" src="https://raw.githubusercontent.com/klaasnicolaas/action-inactivity-lock/main/.github/assets/icon.svg" width="96">
  </picture>
</p>

<p align="center">
  <strong>Automatically lock stale issues and pull requests after a configurable period.</strong>
</p>

<p align="center">
  <a href="https://github.com/klaasnicolaas/action-inactivity-lock/actions/workflows/tests.yaml"><img src="https://github.com/klaasnicolaas/action-inactivity-lock/actions/workflows/tests.yaml/badge.svg" alt="Tests"></a>
  <a href="https://codecov.io/gh/klaasnicolaas/action-inactivity-lock"><img src="https://codecov.io/gh/klaasnicolaas/action-inactivity-lock/branch/main/graph/badge.svg?token=FJXBX4ZTI1" alt="Coverage"></a>
  <a href="https://github.com/klaasnicolaas/action-inactivity-lock/releases"><img src="https://img.shields.io/github/v/release/klaasnicolaas/action-inactivity-lock" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/klaasnicolaas/action-inactivity-lock" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/klaasnicolaas/action-inactivity-lock/releases/latest"><strong>Latest release</strong></a>
  &middot;
  <a href="#example-workflow"><strong>Usage</strong></a>
  &middot;
  <a href="#inputs"><strong>Inputs</strong></a>
  &middot;
  <a href="CONTRIBUTING.md"><strong>Contributing</strong></a>
</p>

<p align="center">
  Keep repositories tidy with scheduled, rate-limit-aware maintenance and separate inactivity rules for issues and pull requests.
</p>

# Inactivity Lock

Lock closed issues and pull requests after a configurable period of inactivity.
The action uses GitHub's [GraphQL API](https://docs.github.com/en/graphql/overview)
to fetch conversations efficiently and maintains a configurable rate-limit
buffer while processing them.

## Features

- **Lock Issues & Pull Requests**: Locks issues and pull requests after a certain period of inactivity.
- **Custom Lock Reasons**: Set custom lock reasons for issues and pull requests.
- **Rate Limit Buffer**: Set a rate limit buffer to prevent rate limit issues.
- **Detailed Error Messages**: Provides clear error messages when something goes wrong.

## Example workflow

```yaml
name: Lock

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

jobs:
  inactivity-lock:
    name: Lock issues and PRs
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
    steps:
      - name: 🔒 Lock closed issues and PRs
        uses: klaasnicolaas/action-inactivity-lock@v1
        with:
          days-inactive-issues: 30
          days-inactive-prs: 30
          lock-reason-issues: ""
          lock-reason-prs: ""
```

## Inputs

The following input parameters can be used to configure the action.

_If no input parameters are provided, the action will use the default values._

### `repo-token`

The GitHub token used to interact with the GitHub API.

- Default: `${{ github.token }}`
- Usage: **Optional**

### `rate-limit-buffer`

The rate limit buffer is to prevent rate limit issues with the GitHub API. GitHub has a rate limit of 5000 requests per hour. The action will stop if the rate limit buffer is reached. for example, if the rate limit buffer is set to `200`, the action will stop when the remaining request reached `200`.

- default: `100`
- Usage: **Optional**

### `days-inactive-issues`

The number of days an issue should be inactive before it gets locked.

- default: `90`
- Usage: **Optional**

### `days-inactive-prs`

The number of days a pull request should be inactive before it gets locked.

- default: `90`
- Usage: **Optional**

### `lock-reason-issues`

The reason that will be used to lock the issues. Valid reasons are: `off-topic`, `too heated`, `resolved`, `spam`, `""`.

- default: `resolved`
- Usage: **Optional**

### `lock-reason-prs`

The reason that will be used to lock the pull requests. Valid reasons are: `off-topic`, `too heated`, `resolved`, `spam`, `""`.

- default: `resolved`
- Usage: **Optional**

## Outputs

The following output can be used to display the locked issues and pull requests.

Both outputs are a list of objects with the following structure:

```javascript
[
  { number: 1, title: "Title" },
  { number: 2, title: "Title" }
]
```

### `locked-issues`

A list of issues that have been locked.

### `locked-prs`

A list of pull requests that have been locked.

## Full example workflow

```yaml
name: Lock

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

jobs:
  inactivity-lock:
    name: Lock issues and PRs
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
    steps:
      - name: 🔒 Lock closed issues and PRs
        uses: klaasnicolaas/action-inactivity-lock@v1
        id: lock
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          rate-limit-buffer: 200
          days-inactive-issues: 30
          days-inactive-prs: 30
          lock-reason-issues: "resolved"
          lock-reason-prs: "resolved"
      - name: 🔍 Display locked issues and PRs
        run: |
          echo "Locked issues: $(echo '${{ steps.lock.outputs.locked-issues }}' | jq)"
          echo "Locked PRs: $(echo '${{ steps.lock.outputs.locked-prs }}' | jq)"
```

## Contributing

This is an active open-source project. We are always open to people who want to
use the code or contribute to it.

We've set up a separate document for our
[contribution guidelines](CONTRIBUTING.md).

Thank you for being involved! :heart_eyes:

## License

Distributed under the **Apache License 2.0** license. See [`LICENSE`](LICENSE) for more information.
