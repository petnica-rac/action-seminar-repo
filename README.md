# Repository Cloning Action

A GitHub Action that creates a new repository and copies files, issues, and
projects from a source repository.

## Features

- **Smart Defaults**: Source repository defaults to the current repository where
  the action runs
- **Flexible Configuration**: Choose what to copy (files, issues, projects)
- **Workflow Exclusion**: Automatically excludes `.github/workflows` when
  copying files
- **Issue Preservation**: Copies issues with comments, labels, assignees, and
  state
- **Project Support**: Copies GitHub Projects v2 with custom fields
- **Error Handling**: Fail-fast behavior ensures reliability

## Usage

### Basic Example

Clone the current repository to a new repository:

```yaml
name: Clone Repository

on:
  workflow_dispatch:
    inputs:
      target-repo-name:
        description: 'Name of the new repository'
        required: true

jobs:
  clone:
    runs-on: ubuntu-latest
    steps:
      - uses: petnica-rac/action-seminar-repo@v0
        with:
          target-repo: ${{ inputs.target-repo-name }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Example

Copy from a specific source repository with custom options:

```yaml
- uses: petnica-rac/action-seminar-repo@v0
  with:
    source-repo: 'owner/source-repo'
    target-repo: 'new-repo-name'
    target-owner: 'different-owner'
    github-token: ${{ secrets.PAT_TOKEN }}
    copy-files: true
    copy-issues: true
    copy-projects: false
    include-closed-issues: false
    target-visibility: 'private'
```

## Inputs

| Input                   | Description                                                       | Required | Default                 |
| ----------------------- | ----------------------------------------------------------------- | -------- | ----------------------- |
| `source-repo`           | Source repository in format `owner/repo`                          | No       | Current repository      |
| `target-repo`           | Target repository name (without owner)                            | **Yes**  | -                       |
| `target-owner`          | Target owner/org                                                  | No       | Source repository owner |
| `github-token`          | GitHub token with repo, project, and org permissions              | **Yes**  | `${{ github.token }}`   |
| `copy-files`            | Copy all files from default branch                                | No       | `true`                  |
| `copy-issues`           | Copy all issues with comments and metadata                        | No       | `true`                  |
| `copy-projects`         | Copy Projects v2                                                  | No       | `true`                  |
| `include-closed-issues` | Include closed issues when copying                                | No       | `false`                 |
| `target-visibility`     | Visibility of target repository (`public`, `private`, `internal`) | No       | `private`               |
| `default-branch`        | Default branch name for target repository                         | No       | `main`                  |

## Outputs

| Output                 | Description                            |
| ---------------------- | -------------------------------------- |
| `repository-url`       | URL of the newly created repository    |
| `repository-full-name` | Full name of repository (`owner/repo`) |
| `files-copied`         | Number of files copied                 |
| `issues-copied`        | Number of issues copied                |
| `projects-copied`      | Number of projects copied              |

## Permissions

The `github-token` must have the following permissions:

- `repo` - Full control of repositories
- `project` - Full control of projects (if copying projects)
- `write:org` - Write access to organization (if creating in an organization)

For most use cases with the default `GITHUB_TOKEN`, you may need to provide a
Personal Access Token (PAT) with these permissions:

```yaml
- uses: petnica-rac/action-seminar-repo@v0
  with:
    target-repo: 'new-repo'
    github-token: ${{ secrets.PAT_TOKEN }}
```

## Limitations

- **Workflow Files**: `.github/workflows` directory is excluded when copying
  files
- **Pull Requests**: Pull requests are not copied
- **Issue Numbers**: Issue numbers will differ in the target repository
  (original number is referenced in the issue body)
- **Large Files**: Files over 100MB cannot be copied via the GitHub API
- **Projects v1**: Only Projects v2 is supported (Projects v1 is deprecated)
- **Reactions**: Issue and comment reactions are not copied

## Example Use Cases

### 1. Create Template Instances

Use this action in a template repository to allow users to create
fully-configured instances:

```yaml
name: Create Instance from Template

on:
  workflow_dispatch:
    inputs:
      instance-name:
        description: 'Instance repository name'
        required: true

jobs:
  create-instance:
    runs-on: ubuntu-latest
    steps:
      - uses: petnica-rac/action-seminar-repo@v0
        with:
          target-repo: ${{ inputs.instance-name }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 2. Repository Backup

Create backups of repositories with all their content:

```yaml
name: Backup Repository

on:
  schedule:
    - cron: '0 0 * * 0' # Weekly backup

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: petnica-rac/action-seminar-repo@v0
        with:
          target-repo:
            'backup-${{ github.event.repository.name }}-${{ github.run_number }}'
          github-token: ${{ secrets.PAT_TOKEN }}
```

### 3. Fork with Issues

Create a fork that includes issues and projects (unlike regular GitHub forks):

```yaml
- uses: petnica-rac/action-seminar-repo@v0
  with:
    source-repo: 'original-owner/original-repo'
    target-repo: 'forked-repo'
    github-token: ${{ secrets.PAT_TOKEN }}
    copy-files: true
    copy-issues: true
    copy-projects: true
```

## Development

This action is built with TypeScript and uses:

- `@octokit/rest` for GitHub REST API operations
- `@octokit/graphql` for GitHub GraphQL API (Projects v2)
- `@actions/core` for GitHub Actions toolkit

### Build

```bash
pnpm install
pnpm run bundle
```

### Lint

```bash
pnpm run lint
```

## License

MIT
