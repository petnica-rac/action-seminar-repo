import * as core from '@actions/core'
import { parseConfig } from './config.js'
import { createGitHubClient } from './services/github-client.js'
import {
  validatePermissions,
  checkTargetDoesNotExist,
  createRepository
} from './services/repository-service.js'
import { copyFiles } from './services/file-service.js'
import { copyIssues } from './services/issue-service.js'
import { copyProjects } from './services/project-service.js'
import type { CopyResults } from './types.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    core.info('Starting repository cloning action...')

    // 1. Parse configuration
    const config = parseConfig()
    core.info(
      `Source: ${config.sourceRepo.owner}/${config.sourceRepo.repo}, Target: ${config.targetOwner}/${config.targetRepo}`
    )

    // 2. Initialize GitHub client
    const client = createGitHubClient(config.githubToken)

    // 3. Validate permissions (fail immediately if insufficient)
    core.info('Validating permissions...')
    await validatePermissions(client, config)

    // 4. Check target repo doesn't exist (fail if exists)
    core.info('Checking target repository does not exist...')
    await checkTargetDoesNotExist(client, config)

    // 5. Create target repository
    core.info('Creating target repository...')
    const repo = await createRepository(client, config)
    core.info(`Created repository: ${repo.html_url}`)

    const results: CopyResults = {
      repositoryUrl: repo.html_url,
      repositoryFullName: repo.full_name,
      filesCopied: 0,
      issuesCopied: 0,
      projectsCopied: 0
    }

    // Track issue mapping for linking to projects
    let issueMapping: import('./types.js').IssueMapping = {}

    // 6. Copy files (if enabled)
    if (config.copyFiles) {
      core.info('Copying files from default branch...')
      results.filesCopied = await copyFiles(client, config, repo)
      core.info(`Copied ${results.filesCopied} files`)
    } else {
      core.info('Skipping file copying (disabled)')
    }

    // 7. Copy issues (if enabled)
    if (config.copyIssues) {
      core.info('Copying issues...')
      const issueResult = await copyIssues(client, config)
      results.issuesCopied = issueResult.count
      issueMapping = issueResult.issueMapping
      core.info(`Copied ${results.issuesCopied} issues`)
    } else {
      core.info('Skipping issue copying (disabled)')
    }

    // 8. Copy projects (if enabled)
    if (config.copyProjects) {
      core.info('Copying projects...')
      results.projectsCopied = await copyProjects(
        config.githubToken,
        config,
        repo,
        issueMapping
      )
      core.info(`Copied ${results.projectsCopied} projects`)
    } else {
      core.info('Skipping project copying (disabled)')
    }

    // 9. Set outputs
    core.setOutput('repository-url', results.repositoryUrl)
    core.setOutput('repository-full-name', results.repositoryFullName)
    core.setOutput('files-copied', results.filesCopied.toString())
    core.setOutput('issues-copied', results.issuesCopied.toString())
    core.setOutput('projects-copied', results.projectsCopied.toString())

    core.info('Repository cloning completed successfully!')
    core.info(`Repository URL: ${results.repositoryUrl}`)
    core.info(
      `Summary: ${results.filesCopied} files, ${results.issuesCopied} issues, ${results.projectsCopied} projects`
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`)
    } else {
      core.setFailed('Action failed with unknown error')
    }
    throw error
  }
}
