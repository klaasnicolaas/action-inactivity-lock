import { describe, expect, it, beforeEach, vi } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { run } from '../src/index.js'

vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
  getOctokit: vi.fn(),
}))

describe('GitHub Action - Run', () => {
  let mockOctokit: any
  const currentDate = new Date('2023-07-01T00:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(currentDate)

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

    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit)
  })

  it('should get all necessary action inputs', async () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'rate-limit-buffer') return '100'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      if (name === 'lock-reason-prs') return 'off-topic'
      return ''
    })

    await run()

    expect(core.getInput).toHaveBeenCalledWith('repo-token')
    expect(core.getInput).toHaveBeenCalledWith('rate-limit-buffer')
    expect(core.getInput).toHaveBeenCalledWith('days-inactive-issues')
    expect(core.getInput).toHaveBeenCalledWith('days-inactive-prs')
    expect(core.getInput).toHaveBeenCalledWith('lock-reason-issues')
    expect(core.getInput).toHaveBeenCalledWith('lock-reason-prs')

    // Ensure getInput is called 6 times
    expect(core.getInput).toHaveBeenCalledTimes(6)
  })
})
