import * as core from '@actions/core'
import * as github from '@actions/github'
import { run, checkRateLimit } from '../src/index'
import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@actions/core')
jest.mock('@actions/github')

const mockCore = core as jest.Mocked<typeof core>
const mockGithub = github as jest.Mocked<typeof github>

describe('GitHub Action - Run', () => {
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

  it('should get all necessary action inputs', async () => {
    const mockGetInput = core.getInput as jest.Mock

    mockGetInput.mockImplementation((name) => {
      if (name === 'repo-token') return 'fake-token'
      if (name === 'rate-limit-buffer') return '100'
      if (name === 'days-inactive-issues') return '30'
      if (name === 'days-inactive-prs') return '30'
      if (name === 'lock-reason-issues') return 'off-topic'
      if (name === 'lock-reason-prs') return 'off-topic'
    })

    await run()

    expect(mockGetInput).toHaveBeenCalledWith('repo-token')
    expect(mockGetInput).toHaveBeenCalledWith('rate-limit-buffer')
    expect(mockGetInput).toHaveBeenCalledWith('days-inactive-issues')
    expect(mockGetInput).toHaveBeenCalledWith('days-inactive-prs')
    expect(mockGetInput).toHaveBeenCalledWith('lock-reason-issues')
    expect(mockGetInput).toHaveBeenCalledWith('lock-reason-prs')
  })
})
