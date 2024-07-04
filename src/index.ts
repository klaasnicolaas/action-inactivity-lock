import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'

/**
 * Rate limit status object.
 * @property remaining Number of requests remaining.
 * @property resetTime Time when the rate limit resets.
 * @property resetTimeHumanReadable Human-readable time when the rate limit resets.
 */
interface RateLimitStatus {
  remaining: number
  resetTime: number
  resetTimeHumanReadable: string
}

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
    const perPage = 100 // Batch size for processing

    core.info('Starting processing of issues and pull requests.')
    core.info('Checking rate limit before processing.')

    const rateLimitStatus = await checkRateLimit(octokit)
    if (rateLimitStatus.remaining > rateLimitBuffer) {
      core.info('Sufficient rate limit available, starting processing.')

      // Fetch all relevant issues and PRs
      const items = await fetchIssuesAndPRs(
        octokit,
        owner,
        repo,
        perPage,
        rateLimitBuffer,
      )
      const issuesList = items.filter((item) => !item.pull_request)
      const pullRequestsList = items.filter((item) => item.pull_request)

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
    }
    core.warning('Initial rate limit too low, stopping processing.')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed with error: ${error.message}`)
    }
  }
}

/**
 * Fetches closed issues and pull requests from a GitHub repository.
 * @param octokit Octokit instance.
 * @param owner Owner of the repository.
 * @param repo Name of the repository.
 * @param perPage Number of items to fetch per page.
 * @param rateLimitBuffer Buffer for remaining rate limit checks.
 * @param page Page number to fetch.
 * @param allItems Array of fetched items.
 * @returns Promise that resolves to an array of fetched items.
 * @throws Error if fetching fails.
 */
export async function fetchIssuesAndPRs(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  perPage: number,
  rateLimitBuffer: number,
  page: number = 1,
  allItems: any[] = [],
): Promise<any[]> {
  core.info(`Fetching issues and PRs on page ${page}`)

  try {
    const query = `repo:${owner}/${repo} state:closed is:unlocked`
    const results = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: perPage,
      page: page,
    })

    const fetchedItems = results.data.items
    allItems.push(...results.data.items)

    // Check rate limit before continuing
    const rateLimitStatus = await checkRateLimit(octokit)
    if (rateLimitStatus.remaining <= rateLimitBuffer) {
      core.warning(
        `Rate limit exceeded, stopping further fetching. Please wait until ${rateLimitStatus.resetTimeHumanReadable}.`,
      )
      return allItems
    }

    if (fetchedItems.length === perPage) {
      // Fetch next batch
      return fetchIssuesAndPRs(
        octokit,
        owner,
        repo,
        perPage,
        rateLimitBuffer,
        page + 1,
        allItems,
      )
    } else {
      core.info(`Total issues and PRs fetched: ${allItems.length}`)
      return allItems
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Failed to fetch issues and PRs: ${error.message}`)
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
  issuesList: any[],
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
    const lastUpdated = new Date(issue.updated_at)
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
  pullRequestsList: any[],
  daysInactivePRs: number,
  lockReasonPRs: 'off-topic' | 'too heated' | 'resolved' | 'spam' | undefined,
): Promise<void> {
  const now = new Date()
  const lockedPRs: { number: number; title: string }[] = []

  for (const pr of pullRequestsList) {
    const lastUpdated = new Date(pr.updated_at)
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
      core.setFailed(`Failed to lock issue/PR #${itemNumber}: ${error.message}`)
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
): Promise<RateLimitStatus> {
  try {
    const rateLimit = await octokit.rest.rateLimit.get()
    const remaining = rateLimit.data.resources.core.remaining
    const reset = rateLimit.data.resources.core.reset

    const now = Math.floor(Date.now() / 1000)
    const resetTimeInSeconds = reset - now
    const resetTimeHumanReadable = new Date(reset * 1000).toUTCString()

    core.info(`Rate limit remaining: ${remaining}`)
    core.info(`Rate limit resets at: ${resetTimeHumanReadable}`)

    return { remaining, resetTime: resetTimeInSeconds, resetTimeHumanReadable }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Failed to check rate limit: ${error.message}`)
    }
    return { remaining: 0, resetTime: 0, resetTimeHumanReadable: '' }
  }
}

// Run the action
run()
