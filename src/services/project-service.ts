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
                      description
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
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldTextValue {
                        text
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldNumberValue {
                        number
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldDateValue {
                        date
                        field {
                          ... on ProjectV2Field {
                            id
                            name
                          }
                        }
                      }
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field {
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
              views(first: 20) {
                nodes {
                  id
                  name
                  layout
                  filter
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
                options?: Array<{
                  id: string
                  name: string
                  color: string
                  description?: string
                }>
              }>
            }
            items: {
              nodes: Array<{
                id: string
                content: { number: number; title: string }
                fieldValues: {
                  nodes: Array<
                    | {
                        text: string
                        field: { id: string; name: string }
                      }
                    | {
                        number: number
                        field: { id: string; name: string }
                      }
                    | {
                        date: string
                        field: { id: string; name: string }
                      }
                    | {
                        name: string
                        field: { id: string; name: string }
                      }
                  >
                }
              }>
            }
            views: {
              nodes: Array<{
                id: string
                name: string
                layout: string
                filter: string | null
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
          // Skip built-in fields (Title, Assignees, Status, Labels, etc.)
          // Also skip special GitHub-managed fields that cannot be created as custom fields
          if (
            [
              'Title',
              'Assignees',
              'Labels',
              'Milestone',
              'Repository',
              'Linked pull requests',
              'Reviewers',
              'Parent issue',
              'Sub-issues progress',
              'Tracks',
              'Tracked by'
            ].includes(field.name)
          ) {
            core.debug(`Skipping built-in field: ${field.name}`)
            continue
          }

          // Only process valid custom field types
          // Valid types: DATE, ITERATION, NUMBER, SINGLE_SELECT, TEXT
          const validFieldTypes = [
            'DATE',
            'ITERATION',
            'NUMBER',
            'SINGLE_SELECT',
            'TEXT'
          ]
          if (!validFieldTypes.includes(field.dataType)) {
            core.warning(
              `Skipping field "${field.name}" with unsupported type: ${field.dataType}`
            )
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
                (opt: {
                  id: string
                  name: string
                  color: string
                  description?: string
                }) => ({
                  name: opt.name,
                  color: opt.color,
                  description: opt.description || ''
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

        // Copy views - DISABLED: GitHub GraphQL API does not support view creation mutations
        // The createProjectV2View and updateProjectV2View mutations are not officially available
        // Views must be created manually through the GitHub UI
        if (project.views.nodes.length > 0) {
          core.warning(
            `Skipping ${project.views.nodes.length} view(s) - GitHub API does not support programmatic view creation. ` +
              `Views must be created manually in the GitHub UI.`
          )
        }

        // Link issues to the project and set field values
        if (project.items.nodes.length > 0) {
          core.info(
            `Linking ${project.items.nodes.length} items to project "${project.title}"...`
          )

          // Get target project fields with their IDs and options
          const targetFieldsQuery = `
            query($projectId: ID!) {
              node(id: $projectId) {
                ... on ProjectV2 {
                  fields(first: 50) {
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
                        }
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
                nodes: Array<{
                  id: string
                  name: string
                  dataType: string
                  options?: Array<{ id: string; name: string }>
                }>
              }
            }
          }

          // Build field name to field mapping
          const fieldMap = new Map<string, { id: string; dataType: string }>()
          const fieldOptionMap = new Map<string, Map<string, string>>() // field name -> option name -> option ID

          for (const field of targetFieldsData.node.fields.nodes) {
            fieldMap.set(field.name, {
              id: field.id,
              dataType: field.dataType
            })

            if (field.options) {
              const optionMap = new Map<string, string>()
              for (const option of field.options) {
                optionMap.set(option.name, option.id)
              }
              fieldOptionMap.set(field.name, optionMap)
            }
          }

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
              // Add issue to project
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

              const addResult = (await graphqlWithAuth(addItemMutation, {
                projectId: newProjectId,
                contentId: targetIssue.targetIssueNodeId
              })) as { addProjectV2ItemById: { item: { id: string } } }

              const newItemId = addResult.addProjectV2ItemById.item.id

              // Set field values
              for (const fieldValue of item.fieldValues.nodes) {
                const field = fieldValue.field

                // Skip if field is undefined or null
                if (!field || !field.name) {
                  core.debug(
                    'Skipping field value with undefined or null field'
                  )
                  continue
                }

                const targetField = fieldMap.get(field.name)

                if (!targetField) {
                  core.debug(
                    `Field "${field.name}" not found in target project, skipping`
                  )
                  continue
                }

                try {
                  // Handle different field types
                  if ('text' in fieldValue && fieldValue.text) {
                    // Text field
                    const updateMutation = `
                      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
                        updateProjectV2ItemFieldValue(input: {
                          projectId: $projectId,
                          itemId: $itemId,
                          fieldId: $fieldId,
                          value: {
                            text: $value
                          }
                        }) {
                          projectV2Item {
                            id
                          }
                        }
                      }
                    `

                    await graphqlWithAuth(updateMutation, {
                      projectId: newProjectId,
                      itemId: newItemId,
                      fieldId: targetField.id,
                      value: fieldValue.text
                    })
                  } else if (
                    'number' in fieldValue &&
                    fieldValue.number != null
                  ) {
                    // Number field
                    const updateMutation = `
                      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
                        updateProjectV2ItemFieldValue(input: {
                          projectId: $projectId,
                          itemId: $itemId,
                          fieldId: $fieldId,
                          value: {
                            number: $value
                          }
                        }) {
                          projectV2Item {
                            id
                          }
                        }
                      }
                    `

                    await graphqlWithAuth(updateMutation, {
                      projectId: newProjectId,
                      itemId: newItemId,
                      fieldId: targetField.id,
                      value: fieldValue.number
                    })
                  } else if ('date' in fieldValue && fieldValue.date) {
                    // Date field
                    const updateMutation = `
                      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Date!) {
                        updateProjectV2ItemFieldValue(input: {
                          projectId: $projectId,
                          itemId: $itemId,
                          fieldId: $fieldId,
                          value: {
                            date: $value
                          }
                        }) {
                          projectV2Item {
                            id
                          }
                        }
                      }
                    `

                    await graphqlWithAuth(updateMutation, {
                      projectId: newProjectId,
                      itemId: newItemId,
                      fieldId: targetField.id,
                      value: fieldValue.date
                    })
                  } else if ('name' in fieldValue && fieldValue.name) {
                    // Single-select field
                    const optionMap = fieldOptionMap.get(field.name)
                    if (!optionMap) {
                      core.debug(
                        `Option map not found for field "${field.name}"`
                      )
                      continue
                    }

                    const optionId = optionMap.get(fieldValue.name)
                    if (!optionId) {
                      core.debug(
                        `Option "${fieldValue.name}" not found in field "${field.name}"`
                      )
                      continue
                    }

                    const updateMutation = `
                      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                        updateProjectV2ItemFieldValue(input: {
                          projectId: $projectId,
                          itemId: $itemId,
                          fieldId: $fieldId,
                          value: {
                            singleSelectOptionId: $optionId
                          }
                        }) {
                          projectV2Item {
                            id
                          }
                        }
                      }
                    `

                    await graphqlWithAuth(updateMutation, {
                      projectId: newProjectId,
                      itemId: newItemId,
                      fieldId: targetField.id,
                      optionId
                    })

                    core.debug(
                      `Set ${field.name} = "${fieldValue.name}" for issue #${targetIssue.targetIssueNumber}`
                    )
                  }
                } catch (error) {
                  core.warning(
                    `Failed to set field "${field.name}" for issue #${targetIssue.targetIssueNumber}: ${error instanceof Error ? error.message : error}`
                  )
                }
              }

              linkedCount++
              core.debug(
                `Linked issue #${targetIssue.targetIssueNumber} to project "${project.title}" with field values`
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
