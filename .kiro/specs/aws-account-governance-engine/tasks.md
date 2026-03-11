# Implementation Plan: AWS Account Governance Engine

## Overview

Incremental implementation of a serverless AWS Account Governance Engine using TypeScript, CDK, Lambda, Step Functions, DynamoDB, API Gateway, SES, and React. Tasks are ordered to build foundational types and utilities first, then each advisor, the action executor, the dashboard API, reporting, and finally the React SPA — wiring everything together with CDK infrastructure.

## Tasks

- [x] 1. Set up project structure, shared types, and utilities
  - [x] 1.1 Initialize monorepo structure with packages for `infra` (CDK), `backend` (Lambda handlers), `shared` (types/utils), and `frontend` (React SPA)
    - Configure TypeScript, Jest, and fast-check in each package
    - Set up shared tsconfig paths so backend and frontend can import from `shared`
    - _Requirements: 9.1, 10.1_

  - [x] 1.2 Define all shared data model types and enums
    - Create `ScanMode`, `RiskLevel`, `AdvisorType`, `ResourceType`, `ActionType`, `ActionStatus`, `ScanStatus` enums/types
    - Create `Recommendation`, `DependencyInfo`, `ScanRecord`, `ScanError`, `ResourceAction`, `GovernanceConfig`, `LookbackConfig`, `ReportConfig`, `OrganizationConfig`, `AccountFilter` interfaces
    - Create `RESOURCE_ACTION_MAP` constant mapping resource types to allowed actions
    - _Requirements: 6.1, 6.2, 6.4, 14.1, 14.8_

  - [ ]* 1.3 Write property test for resource action mapping (Property 17)
    - **Property 17: Resource action mapping correctness**
    - For any resource type, verify available actions match the defined mapping exactly
    - **Validates: Requirements 7.9, 14.1, 14.8**

  - [x] 1.4 Implement configuration validation utilities
    - Implement `validateLookbackPeriod(value: number)` — accept 7-365, reject otherwise with error
    - Implement `validateReportFrequency(value: string)` — accept only "daily", "weekly", "monthly"
    - Implement `validateGovernanceConfig(config: GovernanceConfig)` — validate all fields
    - _Requirements: 9.2, 9.3, 9.4, 8.1_

  - [ ]* 1.5 Write property tests for configuration validation (Properties 21, 22)
    - **Property 21: Report frequency validation** — generate random strings, verify only valid values accepted
    - **Property 22: Lookback period validation** — generate random integers, verify 7-365 accepted, others rejected
    - **Validates: Requirements 8.1, 9.2, 9.3, 9.4**

  - [x] 1.6 Implement DynamoDB data access layer
    - Create `GovernanceDataRepository` class with methods: `putScanRecord`, `getScanRecord`, `updateScanStatus`, `putRecommendation`, `putRecommendations` (batch), `getRecommendation`, `queryRecommendationsByScan`, `queryRecommendationsByAdvisor`, `queryRecommendationsByAccount`, `queryRecommendationsByRiskLevel`, `putAction`, `getAction`, `queryActionsByUser`, `getConfig`, `putConfig`, `getInProgressScan`
    - Use DynamoDB DocumentClient with single-table design (PK/SK patterns from design)
    - Implement GSI queries for advisor, account, risk level, and user lookups
    - _Requirements: 10.3, 7.2, 7.8_

  - [ ]* 1.7 Write property test for recommendation persistence round trip (Property 24)
    - **Property 24: Recommendation persistence round trip**
    - Generate random recommendations, persist via repository, retrieve by scan, verify equivalence
    - **Validates: Requirements 10.3**

  - [x] 1.8 Implement account filter utility
    - Create `applyAccountFilter(accounts: string[], filter: AccountFilter)` — apply include rules first, then exclude rules
    - Handle edge cases: empty filter returns all, all excluded returns empty with warning
    - _Requirements: 13.5, 13.6, 13.7_

  - [ ]* 1.9 Write property test for account filter logic (Property 26)
    - **Property 26: Account filter logic**
    - Generate random account sets and filter rules, verify result equals (include - exclude)
    - **Validates: Requirements 13.5, 13.6, 13.7**

  - [x] 1.10 Implement AWS credential helper for cross-account role assumption
    - Create `assumeCrossAccountRole(accountId: string, roleName: string)` utility returning temporary credentials
    - Create `getClientForAccount(accountId: string, region: string, roleName?: string)` factory for AWS SDK clients
    - _Requirements: 13.1, 13.2, 13.3_

- [ ] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement Safe Cleanup Advisor
  - [x] 3.1 Implement idle resource detection logic
    - Create `SafeCleanupAdvisor` class implementing the `SafeCleanupAdvisorInput` → `SafeCleanupAdvisorOutput` interface
    - Implement detection for: unattached EBS volumes (zero read/write ops), stopped EC2 instances (beyond lookback), unassociated Elastic IPs, load balancers (zero healthy targets), unattached security groups
    - Use read-only AWS APIs only (describeVolumes, describeInstances, describeAddresses, describeTargetHealth, describeSecurityGroups, describeNetworkInterfaces, CloudWatch getMetricStatistics)
    - On access denied or API error for a resource type, log error and continue with remaining resources
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 1.1, 1.3, 1.5_

  - [x] 3.2 Implement dependency checking for idle resources
    - For each flagged idle resource, query related resources (snapshots referencing EBS volumes, launch templates referencing security groups, etc.)
    - If dependencies found: set `riskLevel = "High"`, populate `dependencies` array
    - If no dependencies: set `riskLevel = "Low"`, empty `dependencies` array
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 3.3 Write property tests for Safe Cleanup Advisor (Properties 1, 5, 6)
    - **Property 1: Read-only scanning invariant** — verify all API calls are read-only Describe*/List*/Get*
    - **Property 5: Idle resource detection correctness** — generate random resource states, verify correct flagging
    - **Property 6: Dependency-based risk level assignment** — generate resources with/without dependencies, verify risk level
    - **Validates: Requirements 1.1, 1.5, 2.1-2.5, 3.1-3.4, 14.10**

  - [ ]* 3.4 Write unit tests for Safe Cleanup Advisor
    - Test: correctly identifies unattached EBS volume with zero I/O
    - Test: correctly skips attached EBS volume with active I/O
    - Test: handles access denied on EC2 describe and continues
    - Test: correctly identifies Elastic IP not associated with any instance
    - Test: dependency found sets High risk with dependency list
    - Test: no dependency sets Low risk with empty dependency list
    - _Requirements: 2.1-2.5, 3.1-3.4_

- [x] 4. Implement Permission Drift Detector
  - [x] 4.1 Implement permission drift detection logic
    - Create `PermissionDriftDetector` class implementing the `PermissionDriftDetectorInput` → `PermissionDriftDetectorOutput` interface
    - List all IAM users and roles with attached/inline policies
    - Query CloudTrail for API calls per entity within lookback period
    - Compute set difference: granted permissions minus exercised permissions
    - Flag entities with non-empty difference as over-permissioned, listing specific unused permissions
    - Flag entities with unused admin access (`AdministratorAccess` or `*:*`) as High risk
    - Flag users with zero login + zero API activity as deactivation candidates
    - Log and skip unparseable policies
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 4.2 Write property tests for Permission Drift Detector (Properties 7, 8, 9)
    - **Property 7: Unused permissions identification** — generate random IAM entities with granted/exercised permissions, verify set difference
    - **Property 8: Unused admin access is high risk** — generate entities with/without admin access, verify High risk assignment
    - **Property 9: Inactive IAM user deactivation flagging** — generate users with varying activity, verify deactivation flagging
    - **Validates: Requirements 4.1-4.5**

  - [ ]* 4.3 Write unit tests for Permission Drift Detector
    - Test: user with AdministratorAccess and no API calls flagged as High risk
    - Test: user with no login and no API activity flagged for deactivation
    - Test: unparseable IAM policy logged and skipped
    - Test: correct unused permissions computed for specific user/policy/usage combination
    - _Requirements: 4.1-4.6_

- [x] 5. Implement Zombie Resource Detector
  - [x] 5.1 Implement zombie service detection logic
    - Create `ZombieResourceDetector` class implementing the `ZombieResourceDetectorInput` → `ZombieResourceDetectorOutput` interface
    - Implement detection for: Lambda functions (zero invocations), RDS instances (zero connections), ECS services (zero running tasks), NAT Gateways (zero bytes processed), CloudWatch log groups (no new events) — all within lookback period
    - Use read-only AWS APIs only
    - On error, log and continue with remaining resources
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.2 Implement cost estimation for zombie resources
    - Use AWS Pricing API or hardcoded regional pricing tables to estimate monthly cost per zombie resource
    - Ensure `estimatedMonthlySavings` is always non-null and non-negative for zombie recommendations
    - _Requirements: 5.6, 6.3_

  - [ ]* 5.3 Write property tests for Zombie Resource Detector (Properties 10, 11, 12, 13)
    - **Property 10: Zombie service detection correctness** — generate random service states, verify correct flagging
    - **Property 11: Zombie cost estimation presence** — generate zombie recommendations, verify cost field non-null and non-negative
    - **Property 12: Recommendation structure completeness** — generate random recommendations, verify all required fields
    - **Property 13: Cost savings field consistency** — generate recommendations with/without cost data, verify consistency
    - **Validates: Requirements 5.1-5.6, 6.1-6.5**

  - [ ]* 5.4 Write unit tests for Zombie Resource Detector
    - Test: correctly identifies Lambda function with zero invocations
    - Test: correctly skips RDS instance with active connections
    - Test: includes estimated monthly cost in zombie recommendation
    - Test: recommendation contains all required fields
    - _Requirements: 5.1-5.6_

- [ ] 6. Checkpoint — Ensure all advisor tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Scan Orchestrator (Step Functions)
  - [x] 7.1 Implement scan orchestrator Lambda handlers
    - Create `startScan` handler: check for in-progress scans (reject if exists), create scan record with IN_PROGRESS status, return scanId
    - Create `discoverAccounts` handler: in organization mode, call Organizations API to list member accounts, apply account filters
    - Create `invokeScanAdvisors` handler: fan out Safe Cleanup Advisor, Permission Drift Detector, and Zombie Resource Detector per account per region
    - Create `completeScan` handler: update scan record to COMPLETED with end time, resources evaluated count, and recommendation count
    - Create `failScan` handler: update scan record to FAILED with error details
    - _Requirements: 1.3, 1.4, 10.2, 10.5, 11.1, 11.2, 13.1, 13.4_

  - [x] 7.2 Define Step Functions state machine (ASL in CDK)
    - Define state machine with states: CheckInProgress → DiscoverAccounts (org mode) → FanOutAdvisors (parallel map) → AggregateResults → CompleteScan
    - Set state machine timeout to 1 hour
    - Add error handling: catch errors, invoke failScan handler
    - _Requirements: 10.1, 10.2, 10.5_

  - [ ]* 7.3 Write property tests for Scan Orchestrator (Properties 3, 4, 23, 25)
    - **Property 3: Graceful error continuation** — generate random error injection points, verify scan continues and errors logged
    - **Property 4: Scan record completeness** — generate random scan executions, verify all required fields
    - **Property 23: Scan region coverage** — generate random region configs, verify scanned regions match
    - **Property 25: Concurrent scan rejection** — generate random scan states, verify rejection when in-progress exists
    - **Validates: Requirements 1.3, 1.4, 10.2, 10.5, 11.2, 11.4, 13.4, 13.9**

- [x] 8. Implement Action Executor
  - [x] 8.1 Implement resource action execution logic
    - Create `ActionExecutor` class implementing `ActionExecutorInput` → `ActionExecutorOutput` interface
    - Implement supported actions per resource type using write/delete AWS APIs (EC2 terminate/stop, EBS delete, EIP release, Lambda delete, RDS stop/delete, ECS stop, SG delete, NAT GW delete)
    - Use a separate IAM role with write/delete permissions, distinct from scanning role
    - Validate action type against `RESOURCE_ACTION_MAP` before execution
    - Check for dependencies on the recommendation; if dependencies exist, require explicit `dependencyAcknowledgment` flag — reject if not provided
    - Log every action with user identity, resource, action type, timestamp, and result
    - On failure, set status to FAILED with error details in result field
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8, 14.9, 14.10_

  - [ ]* 8.2 Write property tests for Action Executor (Properties 2, 17, 18, 28)
    - **Property 2: Scanning IAM permission separation** — verify scanning role has no write actions, action role is separate
    - **Property 17: Resource action mapping correctness** — verify action types match defined mapping per resource type
    - **Property 18: Action record completeness** — generate random action executions, verify all fields present
    - **Property 28: Dependency acknowledgment enforcement** — generate actions on resources with/without dependencies, verify acknowledgment required
    - **Validates: Requirements 1.2, 7.9, 7.10, 14.1-14.10**

  - [ ]* 8.3 Write unit tests for Action Executor
    - Test: successful EC2 terminate logs all required fields
    - Test: failed action logs error details
    - Test: action on resource with dependencies requires acknowledgment
    - Test: action without acknowledgment on dependent resource is rejected
    - Test: invalid action type for resource type is rejected
    - _Requirements: 14.1-14.10_

- [ ] 9. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement Dashboard API
  - [x] 10.1 Implement API Gateway Lambda handlers
    - Create handlers for all endpoints: `GET /scans`, `GET /scans/{scanId}`, `POST /scans` (trigger on-demand scan), `GET /recommendations` (with filter query params: advisorType, riskLevel, region, resourceType, accountId, scanId), `GET /recommendations/{id}`, `POST /actions` (initiate resource action), `GET /actions`, `GET /summary`, `GET /trends`, `GET /config`, `PUT /config`
    - Wire handlers to `GovernanceDataRepository` for data access
    - Wire `POST /scans` to Step Functions StartExecution
    - Wire `POST /actions` to Action Executor
    - Wire `PUT /config` through validation utilities before persisting
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 10.2 Implement summary and trend aggregation logic
    - `GET /summary`: aggregate recommendation counts by advisor type and risk level, compute total cost savings
    - `GET /trends`: return recommendation counts for at most last 10 scans, ordered chronologically
    - In organization mode, include per-account recommendation counts and cost savings in summary
    - _Requirements: 7.1, 7.5, 7.7, 12.1, 12.2, 12.4, 12.5_

  - [ ]* 10.3 Write property tests for Dashboard API (Properties 14, 15, 16, 27, 29)
    - **Property 14: Recommendation filtering correctness** — generate random recommendations and filters, verify all returned match criteria
    - **Property 15: Summary aggregation correctness** — generate random recommendation sets, verify grouped counts match
    - **Property 16: Org mode per-account summary** — generate multi-account recommendations, verify per-account counts
    - **Property 27: Cost savings aggregation correctness** — generate recommendations with mixed null/non-null costs, verify sum
    - **Property 29: Trend data correctness** — generate random scan histories, verify at most 10 entries in chronological order
    - **Validates: Requirements 7.1, 7.2, 7.5, 7.7, 7.8, 12.1-12.5**

  - [ ]* 10.4 Write unit tests for Dashboard API
    - Test: GET /recommendations with multiple filters returns only matching results
    - Test: GET /summary counts match manual grouping
    - Test: GET /trends returns at most 10 scans in order
    - Test: POST /actions rejects invalid action type
    - Test: PUT /config rejects invalid lookback period
    - _Requirements: 7.1-7.10_

- [ ] 11. Implement Report Scheduler
  - [x] 11.1 Implement report generation and email delivery
    - Create `ReportScheduler` class implementing `ReportSchedulerInput` interface
    - Generate report content: recommendation counts by advisor type and risk level, top 10 by cost savings (descending), top 5 highest-risk permission drift findings, total estimated monthly cost savings
    - In organization mode: add per-account breakdowns and top 5 accounts by savings (descending)
    - Format as HTML email body
    - Send via SES with retry up to 3 times with exponential backoff (1s, 2s, 4s) on failure
    - Log each retry attempt; after 3 failures, log final failure and stop
    - Archive report to S3 for audit trail
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 12.3_

  - [ ]* 11.2 Write property tests for Report Scheduler (Properties 19, 20)
    - **Property 19: Report content completeness** — generate random recommendation sets, verify report contains all required sections
    - **Property 20: Email retry with exponential backoff** — generate random failure sequences, verify retry count and increasing delays
    - **Validates: Requirements 8.2-8.8, 12.3**

  - [ ]* 11.3 Write unit tests for Report Scheduler
    - Test: top 10 recommendations sorted by cost savings descending
    - Test: top 5 permission drift recommendations sorted by risk
    - Test: per-account breakdown in organization mode
    - Test: report with zero recommendations produces valid output
    - Test: retry 3 times with increasing delays on SES failure
    - _Requirements: 8.1-8.8_

- [ ] 12. Checkpoint — Ensure all backend and API tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement CDK Infrastructure
  - [x] 13.1 Define DynamoDB table and GSIs
    - Create `GovernanceData` table with PK/SK key schema
    - Define GSI1 (advisorType/createdAt), GSI2 (accountId/createdAt), GSI3 (riskLevel/createdAt), GSI4 (userId/initiatedAt)
    - _Requirements: 10.3_

  - [x] 13.2 Define Lambda functions and IAM roles
    - Create Lambda functions for: Safe Cleanup Advisor, Permission Drift Detector, Zombie Resource Detector, Action Executor, Dashboard API handlers, Report Scheduler, Scan Orchestrator handlers
    - Set Lambda timeout to 15 minutes for advisors, appropriate timeouts for others
    - Create read-only IAM role for scanning Lambdas (Describe*, List*, Get* only)
    - Create separate write/delete IAM role for Action Executor Lambda
    - _Requirements: 1.1, 1.2, 14.6_

  - [x] 13.3 Define Step Functions state machine
    - Create state machine from ASL definition in CDK
    - Set 1-hour timeout
    - Wire Lambda invocations for each state
    - _Requirements: 10.1, 10.2_

  - [x] 13.4 Define API Gateway, EventBridge, SES, S3, and CloudFront
    - Create REST API with all endpoint routes and Lambda integrations
    - Create EventBridge rules for scan schedule (cron) and report schedule
    - Configure SES for email delivery
    - Create S3 bucket for report archive and S3 bucket for static website hosting
    - Create CloudFront distribution pointing to website S3 bucket
    - _Requirements: 7.1, 8.1, 8.5, 10.1_

  - [ ]* 13.5 Write CDK assertion tests for infrastructure
    - Test: Lambda functions have correct timeouts and memory
    - Test: IAM roles have correct permissions (read-only for scanning, write for actions)
    - Test: DynamoDB table has correct key schema and GSIs
    - Test: EventBridge rules have correct cron expressions
    - Test: API Gateway has correct routes and integrations
    - Test: S3 buckets have correct access policies
    - Test: CloudFront distribution is configured correctly
    - _Requirements: 1.1, 1.2, 10.1, 14.6_

- [ ] 14. Implement Dashboard SPA (React)
  - [x] 14.1 Set up React app with routing and API client
    - Initialize React app with TypeScript
    - Set up React Router with routes for: Summary, Recommendations List, Recommendation Detail, Trends, Action History, Account Summary (org mode), Configuration
    - Create API client module that calls all Dashboard API endpoints
    - Implement configurable polling interval for real-time updates
    - _Requirements: 7.1, 7.3, 7.4, 7.6_

  - [x] 14.2 Implement Summary and Recommendations views
    - Summary View: recommendation counts by advisor and risk level, total cost savings, last scan timestamp
    - Recommendations List: filterable/sortable table with filters for advisor type, risk level, region, resource type, account ID
    - Recommendation Detail: full details, dependency list, cost savings, available Resource Actions with action buttons
    - _Requirements: 7.1, 7.2, 7.3, 7.8, 7.9_

  - [x] 14.3 Implement Trends, Action History, Account Summary, and Configuration views
    - Trend View: line chart of recommendation counts over last 10 scans
    - Action History: table of past Resource Actions with status
    - Account Summary (org mode): per-account recommendation counts and cost savings
    - Configuration: form for lookback periods, scan schedule, regions, email settings with validation
    - _Requirements: 7.5, 7.7, 7.10, 9.1, 9.2, 9.3, 9.4_

  - [x] 14.4 Implement Resource Action initiation from dashboard
    - Add action buttons on Recommendation Detail view for available actions
    - Show dependency warning and require acknowledgment before executing actions on resources with dependencies
    - Display action result (success/failure) to user
    - _Requirements: 14.1, 14.5, 14.7_

- [ ] 15. Integration wiring and end-to-end tests
  - [x] 15.1 Wire all components together
    - Ensure CDK stack connects all Lambda functions to correct triggers (EventBridge, API Gateway, Step Functions)
    - Verify environment variables and permissions are correctly passed to each Lambda
    - Ensure frontend API client base URL is configured for the deployed API Gateway endpoint
    - _Requirements: 10.1, 10.2, 11.1_

  - [ ]* 15.2 Write integration tests
    - Test: end-to-end scan flow from trigger to recommendation storage (mocked AWS services)
    - Test: organization mode account discovery, filtering, cross-account scanning
    - Test: resource action initiation, execution, logging, and status update
    - Test: report generation and SES send with retry
    - Test: all Dashboard API endpoints return correct data with proper filtering
    - _Requirements: 1.1-1.5, 7.1-7.10, 8.1-8.8, 10.1-10.5, 13.1-13.9, 14.1-14.10_

- [ ] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (29 properties)
- Unit tests validate specific examples and edge cases
- All code uses TypeScript as specified in the design
- AWS SDK interactions should use aws-sdk-client-mock for testing
- fast-check is used for all property-based tests with minimum 100 iterations per property
