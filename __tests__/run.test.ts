import * as core from '@actions/core'
import * as github from '@actions/github'
import { run } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Run', () => {
  let mockOctokit: any
  const currentDate = new Date('2023-07-01T00:00:00Z')

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

  it('should get all necessary action inputs', async () => {
    mockCore.getInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'rate-limit-buffer') return '100'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    await run()

    expect(mockCore.getInput).toHaveBeenCalledWith('repo-token')
    expect(mockCore.getInput).toHaveBeenCalledWith('rate-limit-buffer')
    expect(mockCore.getInput).toHaveBeenCalledWith('days-inactive-issues')
    expect(mockCore.getInput).toHaveBeenCalledWith('days-inactive-prs')
    expect(mockCore.getInput).toHaveBeenCalledWith('lock-reason-issues')
    expect(mockCore.getInput).toHaveBeenCalledWith('lock-reason-prs')

    // Ensure getInput is called 6 times
    expect(mockCore.getInput).toHaveBeenCalledTimes(6)
  })
})
