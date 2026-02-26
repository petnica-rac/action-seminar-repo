import * as core from '@actions/core'
import type { ActionConfig } from './types.js'

/**
 * Parse and validate action inputs
 */
export function parseConfig(): ActionConfig {
  // Get source-repo with default to current repository
  const sourceRepoInput =
    core.getInput('source-repo') || process.env.GITHUB_REPOSITORY || ''
  if (!sourceRepoInput) {
    throw new Error('source-repo is required or must be run in GitHub Actions')
  }

  // Validate and parse source-repo format
  const sourceRepoParts = sourceRepoInput.split('/')
  if (sourceRepoParts.length !== 2) {
    throw new Error(
      `Invalid source-repo format: "${sourceRepoInput}". Expected format: owner/repo`
    )
  }

  const [sourceOwner, sourceRepo] = sourceRepoParts

  // Get target-repo (required)
  const targetRepo = core.getInput('target-repo', { required: true })

  // Get target-owner with default to source owner
  const targetOwner = core.getInput('target-owner') || sourceOwner

  // Get github-token (required with default)
  const githubToken = core.getInput('github-token', { required: true })

  // Get boolean flags
  const copyFiles = core.getBooleanInput('copy-files')
  const copyIssues = core.getBooleanInput('copy-issues')
  const copyProjects = core.getBooleanInput('copy-projects')
  const includeClosedIssues = core.getBooleanInput('include-closed-issues')

  // Get target-visibility with validation
  const targetVisibility = core.getInput('target-visibility') || 'private'
  if (!['public', 'private', 'internal'].includes(targetVisibility)) {
    throw new Error(
      `Invalid target-visibility: "${targetVisibility}". Must be one of: public, private, internal`
    )
  }

  // Get default-branch
  const defaultBranch = core.getInput('default-branch') || 'main'

  return {
    sourceRepo: { owner: sourceOwner, repo: sourceRepo },
    targetRepo,
    targetOwner,
    githubToken,
    copyFiles,
    copyIssues,
    copyProjects,
    includeClosedIssues,
    targetVisibility: targetVisibility as 'public' | 'private' | 'internal',
    defaultBranch
  }
}
