import * as core from '@actions/core'
import * as github from '@actions/github'
import { lockItem, fetchIssuesAndPRs } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Fetch & Lock', () => {
  let mockOctokit: any
  const currentDate = new Date('2024-07-01T00:00:00Z')

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(currentDate)

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
          issuesAndPullRequests: jest.fn(),
        },
        issues: {
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

  it('should warn and return if rate limit is under buffer', async () => {
    mockOctokit.rest.rateLimit.get.mockResolvedValueOnce({
      data: {
        resources: {
          core: {
            remaining: 50, // Simulating rate limit under buffer after page 2
            reset: Math.floor(Date.now() / 1000) + 3600, // Reset time in future
          },
        },
      },
    })

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValueOnce({
      data: {
        items: [
          {
            number: 1,
            pull_request: false,
            updated_at: '2023-05-01T00:00:00Z',
          },
          {
            number: 2,
            pull_request: false,
            updated_at: '2023-05-01T00:00:00Z',
          },
        ],
      },
    })

    await fetchIssuesAndPRs(mockOctokit, 'test-owner', 'test-repo', 100, 100)

    expect(mockOctokit.rest.search.issuesAndPullRequests).toHaveBeenCalledTimes(
      1,
    )

    expect(core.warning).toHaveBeenCalledWith(
      'Rate limit exceeded, stopping further fetching. Please wait until Mon, 01 Jul 2024 01:00:00 GMT.',
    )
  })

  it('should fetch issues and PRs', async () => {
    await fetchIssuesAndPRs(mockOctokit, 'test-owner', 'test-repo', 100, 100)
    expect(mockOctokit.rest.search.issuesAndPullRequests).toHaveBeenCalledWith({
      q: 'repo:test-owner/test-repo state:closed is:unlocked',
      per_page: 100,
      page: 1,
    })
  })

  it('should continue fetching issues and PRs if there are more pages', async () => {
    const mockItemsPage1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      pull_request: false,
      updated_at: new Date('2023-05-01T00:00:00Z').toISOString(),
    }))
    const mockItemsPage2 = Array.from({ length: 90 }, (_, i) => ({
      number: 100 + i + 1,
      pull_request: false,
      updated_at: new Date('2023-05-01T00:00:00Z').toISOString(),
    }))

    mockOctokit.rest.search.issuesAndPullRequests
      .mockResolvedValueOnce({ data: { items: mockItemsPage1 } })
      .mockResolvedValueOnce({ data: { items: mockItemsPage2 } })

    const result = await fetchIssuesAndPRs(
      mockOctokit,
      'test-owner',
      'test-repo',
      100,
      100,
    )

    expect(mockOctokit.rest.search.issuesAndPullRequests).toHaveBeenCalledTimes(
      2,
    )
    expect(result.length).toBe(190)
  })

  it('should handle errors during fetching issues and PRs', async () => {
    mockOctokit.rest.search.issuesAndPullRequests.mockRejectedValueOnce(
      new Error('API error'),
    )

    const result = await fetchIssuesAndPRs(
      mockOctokit,
      'test-owner',
      'test-repo',
      100,
      100,
    )

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to fetch issues and PRs: API error',
    )
    expect(result).toEqual([])
  })

  it('should handle errors during closing issues and PRs', async () => {
    const mockItems = [
      { number: 1, title: 'Issue 1', updated_at: '2023-06-30T00:00:00Z' },
    ]

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValueOnce({
      data: { items: mockItems },
    })

    mockOctokit.rest.issues.lock.mockRejectedValueOnce(new Error('API error'))

    await fetchIssuesAndPRs(mockOctokit, 'test-owner', 'test-repo', 100, 100)
    await lockItem(mockOctokit, 'test-owner', 'test-repo', 1, 'off-topic')

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to lock issue/PR #1: API error',
    )
  })
})
