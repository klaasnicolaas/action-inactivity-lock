/**
 * Rate limit status object.
 * @property remaining Number of requests remaining.
 * @property resetTime Time when the rate limit resets.
 * @property resetTimeHumanReadable Human-readable time when the rate limit resets.
 */
export interface RateLimitStatus {
  remaining: number
  resetTime: number
  resetTimeHumanReadable: string
}

/**
 * Thread object.
 * @property number Thread number.
 * @property title Thread title.
 * @property updatedAt Thread updated at.
 * @property closedAt Thread closed at.
 * @property locked Thread locked.
 * @property pull_request Thread pull request.
 */
export interface Thread {
  __typename: 'Issue' | 'PullRequest';
  number: number
  title: string
  updatedAt: string
  closedAt: string
  locked: boolean
}

/**
 * GraphQL response object.
 * @property search Search object.
 * @property search.pageInfo Page information object.
 * @property search.nodes Thread nodes.
 */
export interface GraphQLResponse {
  search: {
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
    nodes: Thread[]
  }
}

/**
 * Rate limit data object.
 * @property core Core rate limit data.
 * @property graphql GraphQL rate limit data.
 */
export interface RateLimitData {
  core: {
    limit: number
    remaining: number
    reset: number
    used: number
  }
  graphql?: {
    limit: number
    remaining: number
    reset: number
    used: number
  }
}
