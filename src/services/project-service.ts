import * as core from '@actions/core'
import { graphql } from '@octokit/graphql'
import type { ActionConfig, RepositoryInfo } from '../types.js'

/**
 * Copy Projects v2 from source repository to target repository
 */
export async function copyProjects(
  token: string,
  config: ActionConfig,
  targetRepo: RepositoryInfo
): Promise<number> {
  try {
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${token}`
      }
    })

    core.info('Fetching projects from source repository...')

    // Query source repository projects
    const sourceProjectsQuery = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          projectsV2(first: 10) {
            nodes {
              id
              title
              shortDescription
              fields(first: 20) {
                nodes {
                  ... on ProjectV2Field {
                    id
                    name
                    dataType
                  }
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    dataType
                    options {
                      id
                      name
                      color
                    }
                  }
                }
              }
              items(first: 100) {
                nodes {
                  id
                  content {
                    ... on Issue {
                      number
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    const sourceData = (await graphqlWithAuth(sourceProjectsQuery, {
      owner: config.sourceRepo.owner,
      repo: config.sourceRepo.repo
    })) as {
      repository: {
        projectsV2: {
          nodes: Array<{
            id: string
            title: string
            shortDescription: string
            fields: {
              nodes: Array<{
                id: string
                name: string
                dataType: string
                options?: Array<{ id: string; name: string; color: string }>
              }>
            }
            items: {
              nodes: Array<{
                id: string
                content: { number: number; title: string }
              }>
            }
          }>
        }
      }
    }

    const projects = sourceData.repository.projectsV2.nodes
    core.info(`Found ${projects.length} projects to copy`)

    if (projects.length === 0) {
      return 0
    }

    // Use target repository node ID from already-created repo
    const targetRepoId = targetRepo.node_id

    // Get target owner ID (for project creation)
    const ownerQuery = `
      query($login: String!) {
        user(login: $login) {
          id
        }
        organization(login: $login) {
          id
        }
      }
    `

    let targetOwnerId: string
    try {
      const ownerData = (await graphqlWithAuth(ownerQuery, {
        login: config.targetOwner
      })) as { organization?: { id: string }; user?: { id: string } }
      targetOwnerId = ownerData.organization?.id || ownerData.user?.id || ''
    } catch {
      // Fallback: try just user
      const userQuery = `
        query($login: String!) {
          user(login: $login) {
            id
          }
        }
      `
      const userData = (await graphqlWithAuth(userQuery, {
        login: config.targetOwner
      })) as { user: { id: string } }
      targetOwnerId = userData.user.id
    }

    let copiedCount = 0

    // Copy each project
    for (const project of projects) {
      try {
        core.info(`Copying project: ${project.title}`)

        // Create project in target
        const createProjectMutation = `
          mutation($ownerId: ID!, $title: String!, $repositoryId: ID!) {
            createProjectV2(input: {
              ownerId: $ownerId,
              title: $title,
              repositoryId: $repositoryId
            }) {
              projectV2 {
                id
                title
              }
            }
          }
        `

        const createResult = (await graphqlWithAuth(createProjectMutation, {
          ownerId: targetOwnerId,
          title: project.title,
          repositoryId: targetRepoId
        })) as { createProjectV2: { projectV2: { id: string; title: string } } }

        const newProjectId = createResult.createProjectV2.projectV2.id
        core.info(`Created project: ${project.title} (${newProjectId})`)

        // Copy custom fields (skip built-in fields)
        for (const field of project.fields.nodes) {
          // Skip built-in fields (Title, Assignees, Status, etc.)
          if (
            [
              'Title',
              'Assignees',
              'Labels',
              'Milestone',
              'Repository'
            ].includes(field.name)
          ) {
            continue
          }

          try {
            if (field.dataType === 'SINGLE_SELECT' && field.options) {
              // Create single-select field with options
              const createFieldMutation = `
                mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
                  createProjectV2Field(input: {
                    projectId: $projectId,
                    dataType: $dataType,
                    name: $name,
                    singleSelectOptions: $options
                  }) {
                    projectV2Field {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              `

              const options = field.options.map(
                (opt: { id: string; name: string; color: string }) => ({
                  name: opt.name,
                  color: opt.color
                })
              )

              await graphqlWithAuth(createFieldMutation, {
                projectId: newProjectId,
                name: field.name,
                dataType: field.dataType,
                options
              })
              core.debug(`Created field: ${field.name}`)
            } else if (field.dataType !== 'SINGLE_SELECT') {
              // Create other field types without options
              const createFieldMutation = `
                mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!) {
                  createProjectV2Field(input: {
                    projectId: $projectId,
                    dataType: $dataType,
                    name: $name
                  }) {
                    projectV2Field {
                      ... on ProjectV2Field {
                        id
                        name
                      }
                    }
                  }
                }
              `

              await graphqlWithAuth(createFieldMutation, {
                projectId: newProjectId,
                name: field.name,
                dataType: field.dataType
              })
              core.debug(`Created field: ${field.name}`)
            }
          } catch (error) {
            core.warning(
              `Failed to create field "${field.name}": ${error instanceof Error ? error.message : error}`
            )
          }
        }

        // Note: Linking issues would require matching by title from target repo
        // This is complex and may not work well if issues haven't been copied yet
        // or if titles have changed. Skipping for initial implementation.
        if (project.items.nodes.length > 0) {
          core.warning(
            `Project "${project.title}" has ${project.items.nodes.length} items. ` +
              `Automatic item linking is not yet implemented. ` +
              `You will need to add items manually.`
          )
        }

        copiedCount++
      } catch (error) {
        core.error(
          `Failed to copy project "${project.title}": ${error instanceof Error ? error.message : error}`
        )
        throw error // Fail immediately as per requirements
      }
    }

    return copiedCount
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to copy projects: ${error.message}`, {
        cause: error
      })
    }
    throw error
  }
}
