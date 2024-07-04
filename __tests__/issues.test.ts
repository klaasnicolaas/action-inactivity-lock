import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import { processIssues, fetchThreads } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import { Thread } from '../src/interfaces'

jest.mock('@actions/core')
jest.mock('@actions/github')
jest.mock('@octokit/graphql')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>
const mockGraphql = graphql as jest.MockedFunction<typeof graphql>

describe('GitHub Action - Lock issues', () => {
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

  it('should process closed issues and lock inactive ones (with custom reason)', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      return ''
    })

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
        __typename: 'Issue',
        number: 2,
        title: 'Issue 2',
        updatedAt: '2024-06-30T00:00:00Z',
        closedAt: '2024-06-30T00:00:00Z',
        locked: false,
      },
      {
        __typename: 'Issue',
        number: 3,
        title: 'Issue 3',
        updatedAt: '2024-05-30T00:00:00Z',
        closedAt: '2024-05-30T00:00:00Z',
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

    const mockSetOutput = jest.spyOn(core, 'setOutput')
    const mockInfo = jest.spyOn(core, 'info')

    // Run the action
    await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )
    await processIssues(
      mockOctokit,
      'test-owner',
      'test-repo',
      mockItems,
      30,
      'off-topic',
    )

    // Assert locking function calls
    expect(mockOctokit.rest.issues.lock).toHaveBeenCalledTimes(1)
    expect(mockOctokit.rest.issues.lock).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 3,
      lock_reason: 'off-topic',
    })

    // Assert info message
    expect(mockInfo).toHaveBeenCalledWith(
      'Locked issue #3 due to 30 days of inactivity.',
    )

    // Assert setOutput called with locked issues
    expect(mockSetOutput).toHaveBeenCalledWith(
      'locked-issues',
      JSON.stringify([{ number: 3, title: 'Issue 3' }]),
    )
  })

  it('should not lock issues that are less than 30 days inactive', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-issues') return '30'
      return ''
    })

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
        __typename: 'Issue',
        number: 2,
        title: 'Issue 2',
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

    // Mock setOutput
    const mockSetOutput = jest.spyOn(core, 'setOutput')

    // Run the action
    await fetchThreads(
      mockOctokit,
      'test-owner',
      'test-repo',
      'fake-token',
      100,
    )
    await processIssues(
      mockOctokit,
      'test-owner',
      'test-repo',
      mockItems,
      30,
      'resolved',
    )

    // Assert debug messages
    expect(core.debug).toHaveBeenCalledWith(
      'Issue #1 has only 1 days of inactivity.',
    )

    // Assert no locking function call
    expect(mockOctokit.rest.issues.lock).not.toHaveBeenCalled()

    // Assert setOutput not called for locked issues
    expect(mockSetOutput).toHaveBeenCalledWith(
      'locked-issues',
      JSON.stringify([]),
    )
  })
})
