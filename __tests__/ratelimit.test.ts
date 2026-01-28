import * as core from '@actions/core'
import * as github from '@actions/github'
import { run, checkRateLimit } from '../src/index.js'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@actions/core')
vi.mock('@actions/github')

const mockCore = core as vi.Mocked<typeof core>
const mockGithub = github as vi.Mocked<typeof github>

describe('GitHub Action - Rate Limit Handling', () => {
  let mockOctokit: any

  beforeEach(() => {
    vi.clearAllMocks()

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
        search: {
          issuesAndPullRequests: vi.fn(),
        },
        issues: {
          lock: vi.fn(),
        },
        rateLimit: {
          get: vi.fn().mockImplementation(() => {
            // Default mock response for rate limit
            return Promise.resolve({
              data: {
                resources: {
                  core: {
                    remaining: 5000,
                    reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
                  },
                  graphql: {
                    remaining: 5000,
                    reset: Math.floor(Date.now() / 1000) + 3600,
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

    const mockGetRateLimit = vi.fn().mockResolvedValue(mockRateLimitResponse)

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
      new Date(expectedReset * 1000).toUTCString(),
    )

    // Ensure core.info was called with rate limit information
    expect(core.info).toHaveBeenCalledWith(
      `Rate limit core - remaining: ${expectedRemaining}`,
    )
    expect(core.info).toHaveBeenCalledWith(
      `Rate limit core - resets at: ${new Date(expectedReset * 1000).toUTCString()}`,
    )
  })

  it('should fail and set failed status if rate limit check fails', async () => {
    const mockGetRateLimit = vi
      .fn()
      .mockRejectedValue(new Error('API error') as never)

    mockGithub.getOctokit.mockReturnValue({
      rest: {
        rateLimit: {
          get: mockGetRateLimit,
        },
      },
    })

    const result = await checkRateLimit(mockGithub.getOctokit('fake-token'))

    expect(mockGetRateLimit).toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to check rate limit: API error',
    )
    expect(result).toEqual({
      remaining: 0,
      resetTime: 0,
      resetTimeHumanReadable: '',
    })
  })

  it('should warn and stop processing if initial rate limit is exceeded', async () => {
    // Set remaining rate limit to 0 to simulate rate limit exceeded
    mockOctokit.rest.rateLimit.get.mockResolvedValueOnce({
      data: {
        resources: {
          core: {
            remaining: 50,
            reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
          },
          graphql: {
            remaining: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600,
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
})
