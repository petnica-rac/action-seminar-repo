import * as core from '@actions/core'
import { graphql } from '@octokit/graphql'
import type { ActionConfig, IssueMapping, RepositoryInfo } from '../types.js'

/**
 * Copy Projects v2 from source repository to target repository
 */
export async function copyProjects(
  token: string,
  config: ActionConfig,
  targetRepo: RepositoryInfo,
  issueMapping: IssueMapping
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
              views(first: 20) {
                nodes {
                  id
                  name
                  layout
                  filter
                  sortByFields(first: 10) {
                    nodes {
                      field {
                        ... on ProjectV2Field {
                          id
                          name
                        }
                        ... on ProjectV2SingleSelectField {
                          id
                          name
                        }
                      }
                      direction
                    }
                  }
                  groupByFields(first: 10) {
                    nodes {
                      field {
                        ... on ProjectV2Field {
                          id
                          name
                        }
                        ... on ProjectV2SingleSelectField {
                          id
                          name
                        }
                      }
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
            views: {
              nodes: Array<{
                id: string
                name: string
                layout: string
                filter: string | null
                sortByFields: {
                  nodes: Array<{
                    field: { id: string; name: string }
                    direction: string
                  }>
                }
                groupByFields: {
                  nodes: Array<{
                    field: { id: string; name: string }
                  }>
                }
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
    // Try organization first, then user
    let targetOwnerId: string
    try {
      const orgQuery = `
        query($login: String!) {
          organization(login: $login) {
            id
          }
        }
      `
      const orgData = (await graphqlWithAuth(orgQuery, {
        login: config.targetOwner
      })) as { organization: { id: string } }
      targetOwnerId = orgData.organization.id
      core.info(`Target owner is an organization: ${config.targetOwner}`)
    } catch {
      // Fallback: try user if organization query fails
      try {
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
        core.info(`Target owner is a user: ${config.targetOwner}`)
      } catch (error) {
        throw new Error(
          `Failed to get owner ID for "${config.targetOwner}". ` +
            `Ensure it's a valid GitHub user or organization.`,
          { cause: error }
        )
      }
    }

    let copiedCount = 0

    // Copy each project
    for (const project of projects) {
      try {
        core.info(`Copying project: ${project.title}`)

        // Create project in target with target repo name
        const projectTitle = config.targetRepo
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
          title: projectTitle,
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

        // Copy views
        if (project.views.nodes.length > 0) {
          core.info(`Copying ${project.views.nodes.length} views...`)

          // First, get all fields in the target project to build a mapping
          const targetFieldsQuery = `
            query($projectId: ID!) {
              node(id: $projectId) {
                ... on ProjectV2 {
                  fields(first: 50) {
                    nodes {
                      ... on ProjectV2Field {
                        id
                        name
                      }
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          `

          const targetFieldsData = (await graphqlWithAuth(targetFieldsQuery, {
            projectId: newProjectId
          })) as {
            node: {
              fields: {
                nodes: Array<{ id: string; name: string }>
              }
            }
          }

          // Build mapping from field name to field ID
          const fieldNameToId = new Map<string, string>()
          for (const field of targetFieldsData.node.fields.nodes) {
            fieldNameToId.set(field.name, field.id)
          }

          for (const view of project.views.nodes) {
            try {
              core.debug(`Copying view: ${view.name}`)

              // Create view
              const createViewMutation = `
                mutation($projectId: ID!, $name: String!, $layout: ProjectV2ViewLayout!) {
                  createProjectV2View(input: {
                    projectId: $projectId,
                    name: $name,
                    layout: $layout
                  }) {
                    view {
                      id
                      name
                    }
                  }
                }
              `

              const viewResult = (await graphqlWithAuth(createViewMutation, {
                projectId: newProjectId,
                name: view.name,
                layout: view.layout
              })) as {
                createProjectV2View: { view: { id: string; name: string } }
              }

              const newViewId = viewResult.createProjectV2View.view.id

              // Update view with filter if present
              if (view.filter) {
                try {
                  const updateViewMutation = `
                    mutation($projectId: ID!, $viewId: ID!, $filter: String!) {
                      updateProjectV2View(input: {
                        projectId: $projectId,
                        viewId: $viewId,
                        filter: $filter
                      }) {
                        view {
                          id
                        }
                      }
                    }
                  `

                  await graphqlWithAuth(updateViewMutation, {
                    projectId: newProjectId,
                    viewId: newViewId,
                    filter: view.filter
                  })
                } catch (error) {
                  core.warning(
                    `Failed to set filter for view "${view.name}": ${error instanceof Error ? error.message : error}`
                  )
                }
              }

              core.info(`Created view: ${view.name}`)
            } catch (error) {
              core.warning(
                `Failed to copy view "${view.name}": ${error instanceof Error ? error.message : error}`
              )
            }
          }
        }

        // Link issues to the project
        if (project.items.nodes.length > 0) {
          core.info(
            `Linking ${project.items.nodes.length} items to project "${project.title}"...`
          )

          let linkedCount = 0
          for (const item of project.items.nodes) {
            if (!item.content || typeof item.content.number !== 'number') {
              core.debug('Skipping non-issue item')
              continue
            }

            const sourceIssueNumber = item.content.number
            const targetIssue = issueMapping[sourceIssueNumber]

            if (!targetIssue) {
              core.warning(
                `Could not find target issue for source issue #${sourceIssueNumber}. ` +
                  `Ensure issues were copied before projects.`
              )
              continue
            }

            try {
              const addItemMutation = `
                mutation($projectId: ID!, $contentId: ID!) {
                  addProjectV2ItemById(input: {
                    projectId: $projectId,
                    contentId: $contentId
                  }) {
                    item {
                      id
                    }
                  }
                }
              `

              await graphqlWithAuth(addItemMutation, {
                projectId: newProjectId,
                contentId: targetIssue.targetIssueNodeId
              })

              linkedCount++
              core.debug(
                `Linked issue #${targetIssue.targetIssueNumber} to project "${project.title}"`
              )
            } catch (error) {
              core.warning(
                `Failed to link issue #${targetIssue.targetIssueNumber} to project: ${error instanceof Error ? error.message : error}`
              )
            }
          }

          core.info(
            `Linked ${linkedCount}/${project.items.nodes.length} items to project "${project.title}"`
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
