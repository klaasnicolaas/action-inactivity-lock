import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'

export async function run(): Promise<void> {
  try {
    const token = core.getInput('repo-token')
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

    const rateLimitStatus = await checkRateLimit(octokit)
    if (rateLimitStatus.remaining > 0) {
      // Process issues and PRs
      await processIssues(
        octokit,
        owner,
        repo,
        daysInactiveIssues,
        lockReasonIssues,
        perPage,
      )
      await processPullRequests(
        octokit,
        owner,
        repo,
        daysInactivePRs,
        lockReasonPRs,
        perPage,
      )
    } else {
      core.warning('Initial rate limit exceeded, stopping processing.')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export async function processIssues(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  daysInactiveIssues: number,
  lockReasonIssues:
    | 'off-topic'
    | 'too heated'
    | 'resolved'
    | 'spam'
    | undefined,
  perPage: number,
  page: number = 1,
): Promise<void> {
  const now = new Date()

  // Check rate limit before processing
  const rateLimitStatus = await checkRateLimit(octokit)
  if (rateLimitStatus.remaining <= 0) {
    core.warning(
      `Rate limit exceeded, stopping further processing. Please wait for ${rateLimitStatus.resetTime} seconds before continuing.`,
    )
    return
  }

  const issues = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: 'closed',
    per_page: perPage,
    page: page,
  })

  if (issues.data.length === 0) return // No more issues to process

  for (const issue of issues.data) {
    // Check if it's not a PR
    if (!issue.pull_request) {
      const lastUpdated = new Date(issue.updated_at)
      const daysDifference =
        (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)

      if (daysDifference > daysInactiveIssues) {
        // Lock the issue
        await octokit.rest.issues.lock({
          owner,
          repo,
          issue_number: issue.number,
          lock_reason: lockReasonIssues,
        })
        core.info(
          `Locked issue #${issue.number} due to ${daysInactiveIssues} days of inactivity.`,
        )
      }
    }
  }

  // Process next batch
  await processIssues(
    octokit,
    owner,
    repo,
    daysInactiveIssues,
    lockReasonIssues,
    perPage,
    page + 1,
  )
}

export async function processPullRequests(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  daysInactivePRs: number,
  lockReasonPRs: 'off-topic' | 'too heated' | 'resolved' | 'spam' | undefined,
  perPage: number,
  page: number = 1,
): Promise<void> {
  const now = new Date()

  // Check rate limit before processing
  const rateLimitStatus = await checkRateLimit(octokit)
  if (rateLimitStatus.remaining <= 0) {
    core.warning(
      `Rate limit exceeded, stopping further processing. Please wait for ${rateLimitStatus.resetTime} seconds before continuing.`,
    )
    return
  }

  const pullRequests = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'closed',
    per_page: perPage,
    page: page,
  })

  if (pullRequests.data.length === 0) return // No more PRs to process

  for (const pr of pullRequests.data) {
    const lastUpdated = new Date(pr.updated_at)
    const daysDifference =
      (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)

    if (daysDifference > daysInactivePRs) {
      // Lock the PR
      await octokit.rest.issues.lock({
        owner,
        repo,
        issue_number: pr.number,
        lock_reason: lockReasonPRs,
      })
      core.info(
        `Locked PR #${pr.number} due to ${daysInactivePRs} days of inactivity.`,
      )
    }
  }

  // Process next batch
  await processPullRequests(
    octokit,
    owner,
    repo,
    daysInactivePRs,
    lockReasonPRs,
    perPage,
    page + 1,
  )
}

export async function checkRateLimit(octokit: ReturnType<typeof getOctokit>) {
  const rateLimit = await octokit.rest.rateLimit.get()
  const remaining = rateLimit.data.resources.core.remaining
  const reset = rateLimit.data.resources.core.reset
  const now = Math.floor(Date.now() / 1000)
  const resetTime = reset - now

  core.info(`Rate limit remaining: ${remaining}`)
  core.info(`Rate limit resets in: ${resetTime} seconds`)

  return { remaining, resetTime }
}

run()
