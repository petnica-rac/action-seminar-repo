import * as core from '@actions/core'
import type { Octokit } from '@octokit/rest'
import type { ActionConfig, RepositoryInfo } from '../types.js'

/**
 * Validate that the GitHub token has sufficient permissions
 */
export async function validatePermissions(
  client: Octokit,
  config: ActionConfig
): Promise<void> {
  try {
    // Verify authentication
    const { data: user } = await client.users.getAuthenticated()
    core.info(`Authenticated as: ${user.login}`)

    // Check if target owner is an organization
    const { data: targetOwnerData } = await client.users.getByUsername({
      username: config.targetOwner
    })

    if (targetOwnerData.type === 'Organization') {
      core.info(`Target owner "${config.targetOwner}" is an organization`)
      // Note: We can't programmatically verify org permissions, but the API call will fail if insufficient
    } else {
      core.info(`Target owner "${config.targetOwner}" is a user account`)
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Permission validation failed: ${error.message}`, {
        cause: error
      })
    }
    throw error
  }
}

/**
 * Check that the target repository does not already exist
 */
export async function checkTargetDoesNotExist(
  client: Octokit,
  config: ActionConfig
): Promise<void> {
  try {
    await client.repos.get({
      owner: config.targetOwner,
      repo: config.targetRepo
    })
    // If we get here, the repository exists
    throw new Error(
      `Repository ${config.targetOwner}/${config.targetRepo} already exists`
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 404
    ) {
      // Repository doesn't exist - this is what we want
      core.info(`Target repository does not exist - proceeding with creation`)
      return
    }
    // Re-throw other errors
    throw error
  }
}

/**
 * Create the target repository
 */
export async function createRepository(
  client: Octokit,
  config: ActionConfig
): Promise<RepositoryInfo> {
  try {
    // Determine if target owner is an organization or user
    const { data: ownerData } = await client.users.getByUsername({
      username: config.targetOwner
    })

    const isPrivate = config.targetVisibility !== 'public'
    const repoDescription = `Cloned from ${config.sourceRepo.owner}/${config.sourceRepo.repo}`

    let repoData

    if (ownerData.type === 'Organization') {
      core.info(`Creating repository in organization: ${config.targetOwner}`)
      const { data } = await client.repos.createInOrg({
        org: config.targetOwner,
        name: config.targetRepo,
        description: repoDescription,
        private: isPrivate,
        auto_init: true,
        has_issues: true,
        has_projects: true
      })
      repoData = data
    } else {
      core.info(`Creating repository for user: ${config.targetOwner}`)
      const { data } = await client.repos.createForAuthenticatedUser({
        name: config.targetRepo,
        description: repoDescription,
        private: isPrivate,
        auto_init: true,
        has_issues: true,
        has_projects: true
      })
      repoData = data
    }

    return {
      html_url: repoData.html_url,
      full_name: repoData.full_name,
      default_branch: repoData.default_branch || 'main',
      node_id: repoData.node_id
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create repository: ${error.message}`, {
        cause: error
      })
    }
    throw error
  }
}
