import * as core from '@actions/core'
import * as github from '@actions/github'
import { processPullRequests, fetchIssuesAndPRs } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Lock PRs', () => {
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

  it('should process closed PRs and lock inactive ones (with custom reason)', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    const mockItems = [
      { number: 1, title: 'PR 1', updated_at: "2024-06-30T00:00:00Z" }, // Active issue
      { number: 2, title: 'PR 2', updated_at: "2024-06-30T00:00:00Z" }, // Active issue
      {
        number: 3,
        title: 'PR 3',
        updated_at: new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }, // Inactive issue
    ]

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValueOnce({
      data: { items: mockItems },
    })

    const mockSetOutput = jest.spyOn(core, 'setOutput')
    const mockInfo = jest.spyOn(core, 'info')

    // Run the action
    await fetchIssuesAndPRs(mockOctokit, 'test-owner', 'test-repo', 100, 10)
    await processPullRequests(
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
      'Locked PR #3 due to 30 days of inactivity.',
    )

    // Assert setOutput called with locked PRs
    expect(mockSetOutput).toHaveBeenCalledWith(
      'locked-prs',
      JSON.stringify([{ number: 3, title: 'PR 3' }]),
    )
  })

  it('should not lock PRs that are less then 30 days inactive', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'days-inactive-prs') return '30'
      return ''
    })

    const mockItems = [
      { number: 1, title: 'PR 1', updated_at: "2024-06-30T00:00:00Z" }, // Active issue
      { number: 2, title: 'PR 2', updated_at: "2024-06-30T00:00:00Z" }, // Active issue
    ]

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValueOnce({
      data: { items: mockItems },
    })

    const mockSetOutput = jest.spyOn(core, 'setOutput')

    // Run the action
    await fetchIssuesAndPRs(mockOctokit, 'test-owner', 'test-repo', 100, 10)
    await processPullRequests(
      mockOctokit,
      'test-owner',
      'test-repo',
      mockItems,
      30,
      'resolved',
    )

    // Assert debug messages
    expect(core.debug).toHaveBeenCalledWith(
      'PR #1 has only 1 days of inactivity.',
    )

    // Assert no locking function call
    expect(mockOctokit.rest.issues.lock).not.toHaveBeenCalled()

    // Assert setOutput not called for locked prs
    expect(mockSetOutput).toHaveBeenCalledWith('locked-prs', JSON.stringify([]))
  })
})
