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
- **Project Support**: Copies GitHub Projects v2 with custom fields and
  automatically links copied issues to projects
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

The `github-token` input requires a GitHub token with specific permissions to
create repositories and copy content. The default `GITHUB_TOKEN` typically lacks
sufficient permissions, so you'll need to create a Personal Access Token (PAT).

### Classic Personal Access Token

If using a classic PAT, select the following scopes:

- **`repo`** - Full control of private repositories
- **`project`** - Full control of projects (required if copying projects)
- **`write:org`** - Write access to organization (required if creating
  repository in an organization)

### Fine-Grained Personal Access Token (Recommended)

Fine-grained tokens offer more granular control. Configure the following
permissions:

#### Repository Permissions

These permissions apply to **both the source and target repositories**:

- **Administration: Read and write**
  - Required to create repositories
  - Required to access repository-level Projects v2
  - Covers repository settings and projects

- **Contents: Read and write**
  - Required to read files from source repository
  - Required to write files to target repository

- **Issues: Read and write**
  - Required to read issues from source repository
  - Required to create issues, labels, and comments in target repository

- **Metadata: Read** (automatically included)
  - Required for basic repository information

#### Organization Permissions (Conditional)

Only needed if your projects are organization-level projects:

- **Organization projects: Read and write**
  - Required **only** if projects are at the organization level (not
    repository-level)
  - Most projects are repository-level and covered by "Administration"
    permission above

**How to identify project type:**

- Repository-level projects appear under the repository's "Projects" tab →
  covered by **Administration** permission
- Organization-level projects appear under the organization's "Projects" page →
  requires **Organization projects** permission

#### Token Repository Access

When creating your fine-grained token, ensure it has access to:

1. **Source repository** - where files, issues, and projects are copied from
2. **Target owner/organization** - where the new repository will be created

**Note:** Since the target repository doesn't exist yet, you may need to grant
the token access to "All repositories" under the target owner, or manually add
access after the repository is created if you need to re-run the action.

### Usage Example

```yaml
- uses: petnica-rac/action-seminar-repo@v0
  with:
    target-repo: 'new-repo'
    github-token: ${{ secrets.PAT_TOKEN }}
```

### Troubleshooting Permission Errors

**Error: "Resource not accessible by personal access token"**

This typically means your fine-grained token is missing required permissions.
Check that you have:

- **Administration** permission (Read and write) on both source and target repos
- **Organization projects** permission (Read and write) if using org-level
  projects

**Error: "Resource not accessible by integration"**

This occurs when using the default `GITHUB_TOKEN`, which lacks permissions to
read user information and create repositories outside the workflow's repository.
Create a Personal Access Token (classic or fine-grained) instead.

## Limitations

- **Workflow Files**: `.github/workflows` directory is excluded when copying
  files
- **Pull Requests**: Pull requests are not copied
- **Issue Numbers**: Issue numbers will differ in the target repository
  (original number is referenced in the issue body)
- **Large Files**: Files over 100MB cannot be copied via the GitHub API
- **Projects v1**: Only Projects v2 is supported (Projects v1 is deprecated)
- **Reactions**: Issue and comment reactions are not copied
- **Project Item Ordering**: Issues are added to projects but custom ordering
  and field values are not preserved

## Project and Issue Integration

When both `copy-issues` and `copy-projects` are enabled, the action automatically
links copied issues to their corresponding projects. The action:

1. Copies all issues from the source repository
2. Creates a mapping from source issue numbers to target issue IDs
3. Copies all projects with their custom fields
4. Automatically adds the copied issues to their respective projects

**Note**: For automatic issue linking to work, ensure both `copy-issues` and
`copy-projects` are set to `true`. Issues must be copied before projects for the
linking to succeed.

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
