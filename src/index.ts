import * as core from '@actions/core'
import { graphql } from '@octokit/graphql'
import { context, getOctokit } from '@actions/github'

import {
  RateLimitData,
  RateLimitStatus,
  Thread,
  GraphQLResponse,
} from './interfaces'
import { searchThreadsQuery } from './queries'

/**
 * Main function to run the action.
 * @returns Promise that resolves when the action is completed.
 * @throws Error if the action fails.
 */
export async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token')
    const rateLimitBuffer = parseInt(core.getInput('rate-limit-buffer'), 10)
    const daysInactiveIssues = parseInt(
      core.getInput('days-inactive-issues'),
      10,
    )
    const daysInactivePRs = parseInt(core.getInput('days-inactive-prs'), 10)
    const lockReasonIssues = core.getInput('lock-reason-issues') as
      | 'off-topic'
      | 'too heated'
      | 'resolved'
      | 'spam'
      | undefined
    const lockReasonPRs = core.getInput('lock-reason-prs') as
      | 'off-topic'
      | 'too heated'
      | 'resolved'
      | 'spam'
      | undefined

    const octokit = getOctokit(token)
    const { owner, repo } = context.repo

    core.info('Starting processing of issues and pull requests.')
    core.info('Checking rate limit before processing.')

    const rateLimitStatus = await checkRateLimit(octokit)
    if (rateLimitStatus.remaining > rateLimitBuffer) {
      core.info('Sufficient rate limit available, starting processing.')

      // Fetch all relevant issues and PRs
      const items = await fetchThreads(
        octokit,
        owner,
        repo,
        token,
        rateLimitBuffer,
      )
      const { issuesList, pullRequestsList } = filterItems(items)

      // Log the total number of fetched issues and PRs
      core.info(`Total fetched issues: ${issuesList.length}`)
      core.info(`Total fetched PRs: ${pullRequestsList.length}`)

      // Process issues and PRs in parallel
      await Promise.all([
        processIssues(
          octokit,
          owner,
          repo,
          issuesList,
          daysInactiveIssues,
          lockReasonIssues,
        ),
        processPullRequests(
          octokit,
          owner,
          repo,
          pullRequestsList,
          daysInactivePRs,
          lockReasonPRs,
        ),
      ])

      // Check rate limit after processing
      await checkRateLimit(octokit)
      core.info('Processing completed.')
    } else {
      core.warning('Initial rate limit too low, stopping processing.')
    }
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = (error as Error).message
      core.setFailed(`Action failed with error: ${errorMessage}`)
    }
  }
}

/**
 * Filters items into issues and pull requests.
 * @param items List of items to filter.
 * @returns Object with separate lists for issues and pull requests.
 */
export function filterItems(items: Thread[]) {
  const issuesList = items.filter((item) => item.__typename === 'Issue')
  const pullRequestsList = items.filter(
    (item) => item.__typename === 'PullRequest',
  )
  return { issuesList, pullRequestsList }
}

/**
 * Fetches closed issues and pull requests from a GitHub repository.
 * @param octokit Octokit instance.
 * @param owner Owner of the repository.
 * @param repo Name of the repository.
 * @param token Personal access token for GitHub API.
 * @param rateLimitBuffer Buffer for remaining rate limit checks.
 * @param cursor Optional cursor for fetching next page.
 * @param allItems Array of fetched items.
 * @returns Promise that resolves to an array of fetched items.
 * @throws Error if fetching fails.
 */
export async function fetchThreads(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  token: string,
  rateLimitBuffer: number,
  cursor?: string,
  allItems: Thread[] = [],
): Promise<Thread[]> {
  core.info(`Fetching issues and PRs${cursor ? ` after ${cursor}` : ''}`)

  try {
    const queryString = `repo:${owner}/${repo} state:closed is:unlocked`
    const results = await graphql<GraphQLResponse>(searchThreadsQuery, {
      queryString,
      cursor: cursor ?? undefined,
      headers: {
        authorization: `token ${token}`,
      },
    })

    const fetchedItems = results.search.nodes
    allItems.push(...fetchedItems)

    // Check rate limit before continuing
    const rateLimitStatus = await checkRateLimit(octokit, 'graphql')
    if (rateLimitStatus.remaining <= rateLimitBuffer) {
      core.warning(
        `Rate limit exceeded, stopping further fetching. Please wait until ${rateLimitStatus.resetTimeHumanReadable}.`,
      )
      return allItems
    }

    if (results.search.pageInfo.hasNextPage) {
      const nextCursor = results.search.pageInfo.endCursor as string
      // Fetch next batch
      return fetchThreads(
        octokit,
        owner,
        repo,
        token,
        rateLimitBuffer,
        nextCursor,
        allItems,
      )
    } else {
      core.info('All issues and PRs fetched.')
      return allItems
    }
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = (error as Error).message
      core.setFailed(
        `Failed to fetch issues and PRs using GraphQL: ${errorMessage}`,
      )
    }
    return allItems
  }
}

/**
 * Processes a list of issues and locks them if they are inactive.
 * @param octokit Octokit instance.
 * @param owner Owner of the repository.
 * @param repo Name of the repository.
 * @param issuesList List of issues to process.
 * @param daysInactiveIssues Number of days of inactivity to lock an issue.
 * @param lockReasonIssues Reason for locking the issue.
 * @returns Promise that resolves when all issues are processed.
 * @throws Error if an issue fails to process.
 */
export async function processIssues(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  issuesList: Thread[],
  daysInactiveIssues: number,
  lockReasonIssues:
    | 'off-topic'
    | 'too heated'
    | 'resolved'
    | 'spam'
    | undefined,
): Promise<void> {
  const now = new Date()
  const lockedIssues: { number: number; title: string }[] = []

  for (const issue of issuesList) {
    const lastUpdated = new Date(issue.updatedAt)
    const daysDifference =
      (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)

    if (daysDifference > daysInactiveIssues) {
      await lockItem(octokit, owner, repo, issue.number, lockReasonIssues)
      core.info(
        `Locked issue #${issue.number} due to ${daysInactiveIssues} days of inactivity.`,
      )
      // Add the locked issue to the list
      lockedIssues.push({ number: issue.number, title: issue.title })
    } else {
      core.debug(
        `Issue #${issue.number} has only ${daysDifference} days of inactivity.`,
      )
    }
  }

  // Set the output for locked issues
  core.setOutput('locked-issues', JSON.stringify(lockedIssues))
}

/**
 * Processes a list of pull requests and locks them if they are inactive.
 * @param octokit Octokit instance.
 * @param owner Owner of the repository.
 * @param repo Name of the repository.
 * @param pullRequestsList List of pull requests to process.
 * @param daysInactivePRs Number of days of inactivity to lock a pull request.
 * @param lockReasonPRs Reason for locking the pull request.
 * @returns Promise that resolves when all pull requests are processed.
 * @throws Error if a pull request fails to process.
 */
export async function processPullRequests(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  pullRequestsList: Thread[],
  daysInactivePRs: number,
  lockReasonPRs: 'off-topic' | 'too heated' | 'resolved' | 'spam' | undefined,
): Promise<void> {
  const now = new Date()
  const lockedPRs: { number: number; title: string }[] = []

  for (const pr of pullRequestsList) {
    const lastUpdated = new Date(pr.updatedAt)
    const daysDifference =
      (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)

    if (daysDifference > daysInactivePRs) {
      await lockItem(octokit, owner, repo, pr.number, lockReasonPRs)
      core.info(
        `Locked PR #${pr.number} due to ${daysInactivePRs} days of inactivity.`,
      )
      // Add the locked PR to the list
      lockedPRs.push({ number: pr.number, title: pr.title })
    } else {
      core.debug(
        `PR #${pr.number} has only ${daysDifference} days of inactivity.`,
      )
    }
  }
  // Set the output for locked PRs
  core.setOutput('locked-prs', JSON.stringify(lockedPRs))
}

/**
 * Locks an issue or pull request on a GitHub repository.
 * @param octokit Octokit instance.
 * @param owner Owner of the repository.
 * @param repo Name of the repository.
 * @param itemNumber Number of the issue or pull request.
 * @param lockReason Reason for locking the issue or pull request.
 * @returns Promise that resolves when the item is locked.
 * @throws Error if the item fails to lock.
 */
export async function lockItem(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  itemNumber: number,
  lockReason: 'off-topic' | 'too heated' | 'resolved' | 'spam' | undefined,
): Promise<void> {
  // Construct parameters for the lock request
  const lockParams: any = {
    owner,
    repo,
    issue_number: itemNumber,
  }
  if (lockReason) {
    lockParams.lock_reason = lockReason
  }

  try {
    // Lock the issue or PR
    await octokit.rest.issues.lock(lockParams)
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = (error as Error).message
      core.setFailed(`Failed to lock issue/PR #${itemNumber}: ${errorMessage}`)
    }
  }
}

/**
 * Checks the current rate limit status of GitHub API.
 * @param octokit Octokit instance.
 * @returns Promise that resolves to a RateLimitStatus object.
 */
export async function checkRateLimit(
  octokit: ReturnType<typeof getOctokit>,
  apiType: keyof RateLimitData = 'core',
): Promise<RateLimitStatus> {
  try {
    // Fetch rate limit data for REST API
    const rateLimit = await octokit.rest.rateLimit.get()
    const rateLimitData: RateLimitData = rateLimit.data.resources

    // Check if rateLimitData[apiType] is defined
    if (!rateLimitData[apiType]) {
      throw new Error(`Rate limit data for '${apiType}' not found.`)
    }

    let { remaining, reset } = rateLimitData[apiType]

    const now = Math.floor(Date.now() / 1000)
    const resetTimeInSeconds = reset - now
    const resetTimeHumanReadable = new Date(reset * 1000).toUTCString()

    core.info(`Rate limit ${apiType} - remaining: ${remaining}`)
    core.info(`Rate limit ${apiType} - resets at: ${resetTimeHumanReadable}`)

    return { remaining, resetTime: resetTimeInSeconds, resetTimeHumanReadable }
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = (error as Error).message
      core.setFailed(`Failed to check rate limit: ${errorMessage}`)
    }
    return { remaining: 0, resetTime: 0, resetTimeHumanReadable: '' }
  }
}

// Run the action
run()
