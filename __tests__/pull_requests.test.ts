import * as core from '@actions/core'
import * as github from '@actions/github'
import { processPullRequests } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Lock PRs', () => {
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

  it('should process closed PRs and lock inactive ones', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

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

    // @ts-ignore - Ignore missing properties
    const mockLock = jest.fn().mockResolvedValue({})
    mockOctokit.rest.issues.lock.mockImplementationOnce(mockLock)

    await processPullRequests(
      mockOctokit,
      'test-owner',
      'test-repo',
      30,
      'off-topic',
      100,
      100,
    )

    expect(mockCore.info).toHaveBeenCalledWith(
      'Processing pull requests - page 1 for test-owner/test-repo.',
    )

    expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      state: 'closed',
      per_page: 100,
      page: 1,
    })

    expect(mockOctokit.rest.issues.lock).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 1,
      lock_reason: 'off-topic',
    })
  })

  it('should not lock PRs that are less than 30 days inactive', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    // Mock response for pulls.list
    mockOctokit.rest.pulls.list.mockImplementation(
      async ({ owner, repo, state, per_page, page }) => {
        // Simulate fetching issues
        if (page === 1) {
          return {
            data: [
              {
                number: 1,
                updated_at: new Date().toISOString(), // Date is current
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

    // @ts-ignore - Ignore missing properties
    const mockLock = jest.fn().mockResolvedValue({})
    mockOctokit.rest.issues.lock.mockImplementationOnce(mockLock)

    await processPullRequests(
      mockOctokit,
      'test-owner',
      'test-repo',
      30,
      'off-topic',
      100,
      100,
    )

    expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      state: 'closed',
      per_page: 100,
      page: 1,
    })

    expect(mockLock).not.toHaveBeenCalled() // Ensure lock function is not called
  })

  it('should warn when rate limit is exceeded during PR locking', async () => {
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
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    await processPullRequests(
      mockOctokit,
      'test-owner',
      'test-repo',
      30,
      'off-topic',
      100,
      100,
    )

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit exceeded'),
    )
    expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled()
    expect(mockOctokit.rest.issues.lock).not.toHaveBeenCalled()
  })
})
