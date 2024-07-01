import * as core from '@actions/core'
import * as github from '@actions/github'
import { processIssues } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Lock issues', () => {
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

  it('should process closed issues and lock inactive ones', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
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

    // @ts-ignore - Ignore missing properties
    const mockLock = jest.fn().mockResolvedValue({})
    mockOctokit.rest.issues.lock.mockImplementationOnce(mockLock)

    await processIssues(
      mockOctokit,
      'test-owner',
      'test-repo',
      30,
      'off-topic',
      100,
      100,
    )

    expect(mockCore.info).toHaveBeenCalledWith(
      'Processing issues - page 1 for test-owner/test-repo.',
    )

    expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledWith({
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

  it('should not lock issues that are less than 30 days inactive', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
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

    await processIssues(
      mockOctokit,
      'test-owner',
      'test-repo',
      30,
      'off-topic',
      100,
      100,
    )

    expect(mockOctokit.rest.issues.listForRepo).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      state: 'closed',
      per_page: 100,
      page: 1,
    })

    expect(mockLock).not.toHaveBeenCalled() // Ensure lock function is not called
  })

  it('should warn when rate limit is exceeded during issue locking', async () => {
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
      if (name === 'days-inactive-issues') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      return ''
    })

    await processIssues(
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
    expect(mockOctokit.rest.issues.listForRepo).not.toHaveBeenCalled()
    expect(mockOctokit.rest.issues.lock).not.toHaveBeenCalled()
  })
})
