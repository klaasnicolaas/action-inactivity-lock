import * as core from '@actions/core'
import * as github from '@actions/github'
import { run, checkRateLimit } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Rate Limit Handling', () => {
  let mockOctokit: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock context.repo using Object.defineProperty
    Object.defineProperty(mockGithub.context, 'repo', {
      value: {
        owner: 'test-owner',
        repo: 'test-repo',
      },
      writable: true, // Ensure it can be modified
    })

    // Mock Octokit instance with rate limit functionality
    mockOctokit = {
      rest: {
        issues: {
          listForRepo: jest.fn(),
          lock: jest.fn(),
        },
        pulls: {
          list: jest.fn(),
        },
        rateLimit: {
          get: jest.fn().mockImplementation(() => {
            // Default mock response for rate limit
            return Promise.resolve({
              data: {
                resources: {
                  core: {
                    remaining: 5000,
                    reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
                  },
                },
              },
            })
          }),
        },
      },
    }

    mockGithub.getOctokit.mockReturnValue(mockOctokit)
  })

  it('should check rate limit status', async () => {
    const mockRateLimitResponse = {
      data: {
        resources: {
          core: {
            remaining: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
          },
        },
      },
    }

    const expectedRemaining =
      mockRateLimitResponse.data.resources.core.remaining
    const expectedReset = mockRateLimitResponse.data.resources.core.reset

    const mockGetRateLimit = jest.fn().mockResolvedValue(mockRateLimitResponse)

    mockGithub.getOctokit.mockReturnValue({
      rest: {
        rateLimit: {
          get: mockGetRateLimit,
        },
      },
    })

    const rateLimitStatus = await checkRateLimit(
      mockGithub.getOctokit('fake-token'),
    )

    expect(mockGetRateLimit).toHaveBeenCalled()
    expect(rateLimitStatus.remaining).toEqual(expectedRemaining)

    // Adjusted assertions for reset time with a small tolerance (1 second)
    expect(rateLimitStatus.resetTime).toBeGreaterThanOrEqual(
      expectedReset - Math.floor(Date.now() / 1000) - 1,
    )
    expect(rateLimitStatus.resetTime).toBeLessThanOrEqual(
      expectedReset - Math.floor(Date.now() / 1000) + 1,
    )

    // Adjusted assertions for human-readable reset time
    expect(rateLimitStatus.resetTimeHumanReadable).toEqual(
      new Date(expectedReset * 1000).toLocaleString(),
    )

    // Ensure core.info was called with rate limit information
    expect(core.info).toHaveBeenCalledWith(
      `Rate limit remaining: ${expectedRemaining}`,
    )
    expect(core.info).toHaveBeenCalledWith(
      `Rate limit resets at: ${new Date(expectedReset * 1000).toLocaleString()}`,
    )
  })

  it('should fail and set failed status if rate limit check fails', async () => {
    const mockGetRateLimit = jest.fn().mockRejectedValue(new Error('API error') as never)

    mockGithub.getOctokit.mockReturnValue({
      rest: {
        rateLimit: {
          get: mockGetRateLimit,
        },
      },
    })

    const result = await checkRateLimit(mockGithub.getOctokit('fake-token'))

    expect(mockGetRateLimit).toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('Failed to check rate limit: API error')
    expect(result).toEqual({ remaining: 0, resetTime: 0, resetTimeHumanReadable: '' });
  })

  it('should warn and stop processing if initial rate limit is exceeded', async () => {
    // Set remaining rate limit to 0 to simulate rate limit exceeded
    mockOctokit.rest.rateLimit.get.mockResolvedValueOnce({
      data: {
        resources: {
          core: {
            remaining: 0,
            reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
          },
        },
      },
    })

    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'rate-limit-buffer') return '100'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'days-inactive-prs') return '1'
      if (name === 'lock-reason-issues') return 'off-topic'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    await run()

    expect(mockCore.warning).toHaveBeenCalledWith(
      'Initial rate limit too low, stopping processing.',
    )
  })

  it('should process issues and pull requests if rate limit allows', async () => {
    // Set remaining rate limit to 100 to simulate enough remaining calls
    mockOctokit.rest.rateLimit.get.mockResolvedValueOnce({
      data: {
        resources: {
          core: {
            remaining: 200,
            reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
          },
        },
      },
    })

    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'rate-limit-buffer') return '100'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    // Mock response for listForRepo
    mockOctokit.rest.issues.listForRepo.mockImplementation(
      async ({ owner, repo, state, per_page, page }) => {
        // Simulate fetching issues
        if (page === 1) {
          return {
            data: [
              {
                number: 1,
                pull_request: null,
                updated_at: '2023-06-29T12:00:00Z', // Assuming this issue is inactive
              },
            ],
          }
        } else {
          return {
            data: [], // Simulate no more issues on subsequent pages
          }
        }
      },
    )

    // Mock response for list
    mockOctokit.rest.pulls.list.mockImplementation(
      async ({ owner, repo, state, per_page, page }) => {
        // Simulate fetching PRs
        if (page === 1) {
          return {
            data: [
              {
                number: 1,
                updated_at: '2023-05-29T12:00:00Z', // Assuming this issue is inactive
              },
            ],
          }
        } else {
          return {
            data: [], // Simulate no more PRs on subsequent pages
          }
        }
      },
    )

    await run()

    // Ensure processing functions were called
    expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalled()
    expect(mockOctokit.rest.pulls.list).toHaveBeenCalled()
  })
})
