import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import { lockItem, fetchThreads, filterItems } from '../index.js'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Thread } from '../interfaces.js'

vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('@octokit/graphql')

const mockCore = core as vi.Mocked<typeof core>
const mockGithub = github as vi.Mocked<typeof github>
const mockGraphql = graphql as vi.MockedFunction<typeof graphql>

describe('GitHub Action - Fetch & Lock', () => {
  let mockOctokit: any
  const currentDate = new Date('2024-07-01T00:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers().setSystemTime(currentDate)

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

  it('should warn and return if rate limit is under buffer', async () => {
    mockOctokit.rest.rateLimit.get.mockResolvedValueOnce({
      data: {
        resources: {
          core: {
            remaining: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
          graphql: {
            remaining: 50,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      },
    })

    mockGraphql.mockResolvedValueOnce({
      search: {
        nodes: [
          {
            __typename: 'Issue',
            number: 1,
            title: 'Issue 1',
            updatedAt: '2023-06-30T00:00:00Z',
            closedAt: '2023-06-30T00:00:00Z',
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
    })

    await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )

    expect(mockGraphql).toHaveBeenCalledTimes(1)

    expect(core.warning).toHaveBeenCalledWith(
      'Rate limit exceeded, stopping further fetching. Please wait until Mon, 01 Jul 2024 01:00:00 GMT.',
    )
  })

  it('should fetch issues and PRs', async () => {
    await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )
    expect(mockGraphql).toHaveBeenCalledWith(expect.any(String), {
      cursor: undefined,
      headers: {
        authorization: 'token fake-token',
      },
      queryString: 'repo:test-owner/test-repo state:closed is:unlocked',
    })
  })

  it('should continue fetching threads if there are more', async () => {
    const mockItemsPage1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      updated_at: new Date('2023-05-01T00:00:00Z').toISOString(),
    }))
    const mockItemsPage2 = Array.from({ length: 90 }, (_, i) => ({
      number: 100 + i + 1,
      updated_at: new Date('2023-05-01T00:00:00Z').toISOString(),
    }))

    mockGraphql
      .mockResolvedValueOnce({
        search: {
          nodes: mockItemsPage1,
          pageInfo: {
            hasNextPage: true,
            endCursor: 'cursor-1',
          },
        },
      })
      .mockResolvedValueOnce({
        search: {
          nodes: mockItemsPage2,
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      })

    const result = await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )

    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(result.length).toBe(190)
  })

  it('should handle errors during fetching issues and PRs', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('API error'))

    const result = await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to fetch issues and PRs using GraphQL: API error',
    )
    expect(result).toEqual([])
  })

  it('should handle errors during closing issues and PRs', async () => {
    const mockItems: Thread[] = [
      {
        __typename: 'Issue',
        number: 1,
        title: 'Issue 1',
        updatedAt: '2024-06-30T00:00:00Z',
        closedAt: '2024-06-30T00:00:00Z',
        locked: false,
      },
      {
        __typename: 'PullRequest',
        number: 2,
        title: 'PR 1',
        updatedAt: '2024-06-30T00:00:00Z',
        closedAt: '2024-06-30T00:00:00Z',
        locked: false,
      },
    ]

    mockGraphql.mockResolvedValueOnce({
      search: {
        nodes: mockItems,
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
    })

    mockOctokit.rest.issues.lock.mockRejectedValueOnce(new Error('API error'))

    await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )
    await lockItem(mockOctokit, 'test-owner', 'test-repo', 1, 'off-topic')

    expect(core.setFailed).toHaveBeenCalledWith(
      'Failed to lock issue/PR #1: API error',
    )
  })

  it('should correctly filter issues and pull requests', () => {
    const mockItems: Thread[] = [
      {
        __typename: 'Issue',
        number: 1,
        title: 'Issue 1',
        updatedAt: '2024-06-30T00:00:00Z',
        closedAt: '2024-06-30T00:00:00Z',
        locked: false,
      },
      {
        __typename: 'PullRequest',
        number: 2,
        title: 'PR 1',
        updatedAt: '2024-06-30T00:00:00Z',
        closedAt: '2024-06-30T00:00:00Z',
        locked: false,
      },
      {
        __typename: 'Issue',
        number: 3,
        title: 'Issue 2',
        updatedAt: '2024-05-30T00:00:00Z',
        closedAt: '2024-05-30T00:00:00Z',
        locked: false,
      },
      {
        __typename: 'PullRequest',
        number: 4,
        title: 'PR 2',
        updatedAt: '2024-05-30T00:00:00Z',
        closedAt: '2024-05-30T00:00:00Z',
        locked: false,
      },
    ]

    // Act
    const { issuesList, pullRequestsList } = filterItems(mockItems)

    // Assert
    expect(issuesList.length).toBe(2)
    expect(pullRequestsList.length).toBe(2)
  })
})
