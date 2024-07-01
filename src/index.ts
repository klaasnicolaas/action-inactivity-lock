import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'

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

    const rateLimitStatus = await checkRateLimit(octokit)
    if (rateLimitStatus.remaining > rateLimitBuffer) {
      core.info('Sufficient rate limit available, starting processing.')
      // Process issues and PRs in parallel
      await Promise.all([
        processIssues(
          octokit,
          owner,
          repo,
          daysInactiveIssues,
          lockReasonIssues,
          perPage,
          rateLimitBuffer,
        ),
        processPullRequests(
          octokit,
          owner,
          repo,
          daysInactivePRs,
          lockReasonPRs,
          perPage,
          rateLimitBuffer,
        ),
      ])
    } else {
      core.warning('Initial rate limit too low, stopping processing.')
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
  rateLimitBuffer: number,
  lockedIssues: { number: number; title: string }[] = [],
  page: number = 1,
): Promise<void> {
  const now = new Date()

  // Check rate limit before processing
  const rateLimitStatus = await checkRateLimit(octokit)
  if (rateLimitStatus.remaining <= rateLimitBuffer) {
    core.warning(
      `Rate limit exceeded, stopping further processing. Please wait until ${rateLimitStatus.resetTimeHumanReadable}.`,
    )
    return
  }

  try {
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'closed',
      per_page: perPage,
      page: page,
    })

    // No more issues to process
    if (issues.data.length === 0) {
      core.info(`No more issues to process.`)
      // Set the output for locked issues
      core.setOutput('locked-issues', JSON.stringify(lockedIssues))
      return
    }

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
          // Add the locked issue to the list
          lockedIssues.push({ number: issue.number, title: issue.title })
        } else {
          core.debug(
            `Issue #${issue.number} has only ${daysDifference} days of inactivity.`,
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
      rateLimitBuffer,
      lockedIssues,
      page + 1,
    )
  } catch (error) {
    core.setFailed(`Failed to process issues: ${error}`)
  }
}

export async function processPullRequests(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  daysInactivePRs: number,
  lockReasonPRs: 'off-topic' | 'too heated' | 'resolved' | 'spam' | undefined,
  perPage: number,
  rateLimitBuffer: number,
  lockedPRs: { number: number; title: string }[] = [],
  page: number = 1,
): Promise<void> {
  const now = new Date()

  // Check rate limit before processing
  const rateLimitStatus = await checkRateLimit(octokit)
  if (rateLimitStatus.remaining <= rateLimitBuffer) {
    core.warning(
      `Rate limit exceeded, stopping further processing. Please wait until ${rateLimitStatus.resetTimeHumanReadable}`,
    )
    return
  }

  try {
    const pullRequests = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'closed',
      per_page: perPage,
      page: page,
    })

    // No more PRs to process
    if (pullRequests.data.length === 0) {
      core.info(`No more PRs to process.`)
      // Set the output for locked PRs
      core.setOutput('locked-prs', JSON.stringify(lockedPRs))
      return
    }

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
        // Add the locked PR to the list
        lockedPRs.push({ number: pr.number, title: pr.title })
      } else {
        core.debug(
          `PR #${pr.number} has only ${daysDifference} days of inactivity.`,
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
      rateLimitBuffer,
      lockedPRs,
      page + 1,
    )
  } catch (error) {
    core.setFailed(`Failed to process pull requests: ${error}`)
  }
}

export async function checkRateLimit(octokit: ReturnType<typeof getOctokit>) {
  const rateLimit = await octokit.rest.rateLimit.get()
  const remaining = rateLimit.data.resources.core.remaining
  const reset = rateLimit.data.resources.core.reset

  const now = Math.floor(Date.now() / 1000)
  const resetTimeInSeconds = reset - now
  const resetTimeHumanReadable = new Date(reset * 1000).toLocaleString()

  core.info(`Rate limit remaining: ${remaining}`)
  core.info(`Rate limit resets at: ${resetTimeHumanReadable}`)

  return { remaining, resetTime: resetTimeInSeconds, resetTimeHumanReadable }
}

run()
