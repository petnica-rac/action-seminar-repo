import * as core from '@actions/core'
import type { Octokit } from '@octokit/rest'
import type { ActionConfig, RepositoryInfo } from '../types.js'

interface TreeItem {
  path?: string
  mode?: string
  type?: string
  sha?: string
  size?: number
  url?: string
}

/**
 * Copy files from source repository to target repository
 */
export async function copyFiles(
  client: Octokit,
  config: ActionConfig,
  targetRepo: RepositoryInfo
): Promise<number> {
  try {
    core.info('Fetching source repository tree...')

    // Step 1: Get source repository default branch
    const { data: sourceRepoData } = await client.repos.get({
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo
    })
    const sourceBranch = sourceRepoData.default_branch

    // Step 2: Get branch reference
    const { data: refData } = await client.git.getRef({
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo,
      ref: `heads/${sourceBranch}`
    })
    const commitSha = refData.object.sha

    // Step 3: Get commit
    const { data: commitData } = await client.git.getCommit({
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo,
      commit_sha: commitSha
    })
    const treeSha = commitData.tree.sha

    // Step 4: Get tree recursively
    const { data: treeData } = await client.git.getTree({
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo,
      tree_sha: treeSha,
      recursive: 'true'
    })

    // Filter to only files (blobs) and exclude workflow files
    const files = treeData.tree.filter((item: TreeItem) => {
      if (item.type !== 'blob') return false
      if (item.path?.startsWith('.github/workflows/')) {
        core.info(`Excluding workflow file: ${item.path}`)
        return false
      }
      return true
    })

    core.info(`Found ${files.length} files to copy`)

    if (files.length === 0) {
      core.warning('No files to copy from source repository')
      return 0
    }

    // Step 5: Create blobs in target repository
    core.info('Creating blobs in target repository...')
    const newTree: Array<{
      path: string
      mode: '100644' | '100755' | '040000' | '160000' | '120000'
      type: 'tree' | 'blob' | 'commit'
      sha: string
    }> = []

    // Process files in batches of 50 to manage rate limits
    const batchSize = 50
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      core.info(
        `Processing files ${i + 1}-${Math.min(i + batchSize, files.length)} of ${files.length}`
      )

      await Promise.all(
        batch.map(async (file: TreeItem) => {
          try {
            // Get blob content from source
            const { data: blobData } = await client.git.getBlob({
              owner: config.sourceRepo.owner,
              repo: config.sourceRepo.repo,
              file_sha: file.sha!
            })

            // Create blob in target
            const { data: newBlob } = await client.git.createBlob({
              owner: config.targetOwner,
              repo: config.targetRepo,
              content: blobData.content,
              encoding: blobData.encoding as 'utf-8' | 'base64'
            })

            newTree.push({
              path: file.path!,
              mode: file.mode! as
                | '100644'
                | '100755'
                | '040000'
                | '160000'
                | '120000',
              type: 'blob',
              sha: newBlob.sha
            })
          } catch (error) {
            // Skip files over 100MB (GitHub API limitation)
            if (error instanceof Error && error.message.includes('too large')) {
              core.warning(`Skipping large file: ${file.path}`)
            } else {
              throw error
            }
          }
        })
      )
    }

    core.info(`Created ${newTree.length} blobs in target repository`)

    // Step 6: Get target repository's current commit
    const { data: targetRefData } = await client.git.getRef({
      owner: config.targetOwner,
      repo: config.targetRepo,
      ref: `heads/${targetRepo.default_branch}`
    })
    const targetCommitSha = targetRefData.object.sha

    // Step 7: Create new tree
    const { data: newTreeData } = await client.git.createTree({
      owner: config.targetOwner,
      repo: config.targetRepo,
      tree: newTree,
      base_tree: undefined // Don't use base_tree to replace everything
    })

    // Step 8: Create commit
    const { data: newCommit } = await client.git.createCommit({
      owner: config.targetOwner,
      repo: config.targetRepo,
      message: `Copy files from ${config.sourceRepo.owner}/${config.sourceRepo.repo}`,
      tree: newTreeData.sha,
      parents: [targetCommitSha]
    })

    // Step 9: Update branch reference
    await client.git.updateRef({
      owner: config.targetOwner,
      repo: config.targetRepo,
      ref: `heads/${targetRepo.default_branch}`,
      sha: newCommit.sha
    })

    core.info('Files copied successfully')
    return newTree.length
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to copy files: ${error.message}`, {
        cause: error
      })
    }
    throw error
  }
}
