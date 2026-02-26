import * as core from '@actions/core'
import { Octokit } from '@octokit/rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'

/**
 * Create and configure an Octokit client with retry and throttling plugins
 */
export function createGitHubClient(token: string): Octokit {
  const OctokitWithPlugins = Octokit.plugin(retry, throttling)

  return new OctokitWithPlugins({
    auth: token,
    throttle: {
      onRateLimit: (
        retryAfter: number,
        options: { method: string; url: string }
      ) => {
        core.warning(
          `Rate limit hit for ${options.method} ${options.url}, retrying after ${retryAfter}s`
        )
        return true // retry
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        options: { method: string; url: string }
      ) => {
        core.warning(
          `Secondary rate limit hit for ${options.method} ${options.url}`
        )
        return true // retry
      }
    },
    retry: {
      doNotRetry: [400, 401, 403, 404, 422]
    }
  })
}
