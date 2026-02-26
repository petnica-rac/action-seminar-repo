import * as core from '@actions/core'
import type { Octokit } from '@octokit/rest'
import type { ActionConfig } from '../types.js'

/**
 * Copy issues from source repository to target repository
 */
export async function copyIssues(
  client: Octokit,
  config: ActionConfig
): Promise<number> {
  try {
    core.info('Fetching issues from source repository...')

    // Determine state filter
    const state = config.includeClosedIssues ? 'all' : 'open'

    // Fetch all issues with pagination
    const issues = await client.paginate(client.issues.listForRepo, {
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo,
      state,
      per_page: 100
    })

    // Filter out pull requests (issues API returns both)
    const actualIssues = issues.filter((issue) => !issue.pull_request)

    core.info(`Found ${actualIssues.length} issues to copy`)

    if (actualIssues.length === 0) {
      return 0
    }

    // Get existing labels in target repo
    const { data: existingLabels } = await client.issues.listLabelsForRepo({
      owner: config.targetOwner,
      repo: config.targetRepo,
      per_page: 100
    })
    const existingLabelNames = new Set(existingLabels.map((l) => l.name))

    let copiedCount = 0

    // Copy each issue
    for (const issue of actualIssues) {
      try {
        core.info(`Copying issue #${issue.number}: ${issue.title}`)

        // Create labels if they don't exist
        const issueLabels = issue.labels
          .map((l) => (typeof l === 'string' ? l : l.name))
          .filter((name): name is string => name !== undefined)

        for (const labelName of issueLabels) {
          if (!existingLabelNames.has(labelName)) {
            const sourceLabel = issue.labels.find((l) =>
              typeof l === 'object' ? l.name === labelName : l === labelName
            )
            if (typeof sourceLabel === 'object' && sourceLabel.color) {
              try {
                await client.issues.createLabel({
                  owner: config.targetOwner,
                  repo: config.targetRepo,
                  name: labelName,
                  color: sourceLabel.color,
                  description: sourceLabel.description || undefined
                })
                existingLabelNames.add(labelName)
                core.debug(`Created label: ${labelName}`)
              } catch (error) {
                core.warning(`Failed to create label "${labelName}": ${error}`)
              }
            }
          }
        }

        // Prepare issue body with reference to original
        const originalRef = `> Originally issue #${issue.number} in ${config.sourceRepo.owner}/${config.sourceRepo.repo}\n\n`
        const issueBody = originalRef + (issue.body || '')

        // Create the issue
        const { data: newIssue } = await client.issues.create({
          owner: config.targetOwner,
          repo: config.targetRepo,
          title: issue.title,
          body: issueBody,
          labels: issueLabels,
          assignees:
            issue.assignees?.map((a) => a.login).filter(Boolean) || undefined
        })

        // Copy comments
        if (issue.comments > 0) {
          const { data: comments } = await client.issues.listComments({
            owner: config.sourceRepo.owner,
            repo: config.sourceRepo.repo,
            issue_number: issue.number,
            per_page: 100
          })

          for (const comment of comments) {
            const commentBody = `**@${comment.user?.login || 'unknown'} commented:**\n\n${comment.body || ''}`
            await client.issues.createComment({
              owner: config.targetOwner,
              repo: config.targetRepo,
              issue_number: newIssue.number,
              body: commentBody
            })
          }
          core.debug(`Copied ${comments.length} comments`)
        }

        // Set state if closed
        if (issue.state === 'closed') {
          await client.issues.update({
            owner: config.targetOwner,
            repo: config.targetRepo,
            issue_number: newIssue.number,
            state: 'closed'
          })
        }

        copiedCount++
        core.info(
          `Copied issue #${issue.number} -> #${newIssue.number} (${copiedCount}/${actualIssues.length})`
        )
      } catch (error) {
        core.error(
          `Failed to copy issue #${issue.number}: ${error instanceof Error ? error.message : error}`
        )
        throw error // Fail immediately as per requirements
      }
    }

    return copiedCount
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to copy issues: ${error.message}`, {
        cause: error
      })
    }
    throw error
  }
}
