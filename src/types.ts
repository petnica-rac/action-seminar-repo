/**
 * Configuration for the repository cloning action
 */
export interface ActionConfig {
  sourceRepo: { owner: string; repo: string }
  targetRepo: string
  targetOwner: string
  githubToken: string
  copyFiles: boolean
  copyIssues: boolean
  copyProjects: boolean
  includeClosedIssues: boolean
  targetVisibility: 'public' | 'private' | 'internal'
  defaultBranch: string
}

/**
 * Results from the repository cloning operation
 */
export interface CopyResults {
  repositoryUrl: string
  repositoryFullName: string
  filesCopied: number
  issuesCopied: number
  projectsCopied: number
}

/**
 * Repository metadata from GitHub API
 */
export interface RepositoryInfo {
  html_url: string
  full_name: string
  default_branch: string
  node_id: string
}
