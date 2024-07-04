"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchThreadsQuery = void 0;
exports.searchThreadsQuery = `
query ($queryString: String!, $cursor: String) {
    search(query: $queryString, type: ISSUE, first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on Issue {
          number
          title
          updatedAt
          closedAt
          locked
        }
        ... on PullRequest {
          number
          title
          updatedAt
          closedAt
          locked
        }
      }
    }
  }
`;
