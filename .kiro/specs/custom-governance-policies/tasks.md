# Implementation Plan: Custom Governance Policies

## Overview

Incrementally build the custom governance policies feature from shared types and validation outward through backend API/engine to frontend UI. Each task builds on the previous, ensuring no orphaned code. TypeScript throughout, using fast-check for property-based tests.

## Tasks

- [x] 1. Add shared types and policy validator
  - [x] 1.1 Add GovernancePolicy, PolicyCondition, ConditionOperator types to `packages/shared/src/types.ts`
    - Add `ConditionOperator` type with all 10 operators
    - Add `PolicyCondition` interface with `property`, `operator`, `value?`
    - Add `GovernancePolicy` interface with `policyId`, `name`, `description`, `enabled`, `resourceType`, `condition`, `severity`, `createdAt`, `updatedAt`
    - Extend `AdvisorType` union with `"GovernancePolicyEngine"`
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 1.2 Create policy validator in `packages/shared/src/policy-validation.ts`
    - Implement `validatePolicy(policy: Partial<GovernancePolicy>): ValidationResult`
    - Validate `name` is non-empty string
    - Validate `resourceType` is a valid `ResourceType`
    - Validate `condition.operator` is in the valid operators set
    - Validate `condition.property` is non-empty string
    - Validate `greater_than`/`less_than` require numeric `condition.value`
    - Validate `in`/`not_in` require array `condition.value`
    - Collect all errors in a single response (no short-circuit)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 1.3 Export new types and validator from `packages/shared/src/index.ts`
    - Export `GovernancePolicy`, `PolicyCondition`, `ConditionOperator` from types
    - Export `validatePolicy` from policy-validation
    - _Requirements: 1.1_

  - [ ]* 1.4 Write property tests for policy validator in `packages/shared/src/policy-validation.test.ts`
    - **Property 1: Policy JSON round-trip** — For any valid GovernancePolicy, JSON.stringify then JSON.parse produces a deeply equal object
    - **Validates: Requirements 3.8**
    - **Property 2: Validator rejects invalid resource types and accepts valid ones** — Reject iff resourceType not in ResourceType union
    - **Validates: Requirements 1.4, 3.2**
    - **Property 3: Validator rejects invalid operators and accepts valid ones** — Reject iff operator not in valid set
    - **Validates: Requirements 1.5, 3.3**
    - **Property 4: Validator rejects policies with missing required fields** — Empty/missing name or condition.property produces errors
    - **Validates: Requirements 3.1, 3.4, 3.7**
    - **Property 5: Validator enforces operator-value type constraints** — greater_than/less_than reject non-numeric, in/not_in reject non-array
    - **Validates: Requirements 3.5, 3.6**

- [-] 2. Implement condition evaluator and resource property mapper
  - [x] 2.1 Create condition evaluator in `packages/backend/src/advisors/condition-evaluator.ts`
    - Implement `evaluateCondition(propertyValue: unknown, operator: ConditionOperator, conditionValue: unknown): boolean` returning true on violation
    - Implement `extractPropertyValue(resource: Record<string, unknown>, propertyPath: string): unknown` with `Tags.KeyName` dot notation support
    - Handle all 10 operators: equals, not_equals, greater_than, less_than, in, not_in, contains, not_contains, exists, not_exists
    - Handle undefined/null property values gracefully per operator semantics
    - _Requirements: 5.1–5.11, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 2.2 Write property tests for condition evaluator in `packages/backend/src/advisors/condition-evaluator.test.ts`
    - **Property 6: Equality operators are complementary** — equals and not_equals always return opposite results
    - **Validates: Requirements 5.1, 5.2**
    - **Property 7: Numeric comparison operators are correct** — greater_than flags iff v > c, less_than flags iff v < c
    - **Validates: Requirements 5.3, 5.4**
    - **Property 8: Set membership operators are complementary** — in and not_in always return opposite results
    - **Validates: Requirements 5.5, 5.6**
    - **Property 9: Containment operators are complementary** — contains and not_contains always return opposite results
    - **Validates: Requirements 5.7, 5.8**
    - **Property 10: Existence operators are complementary** — exists and not_exists always return opposite results
    - **Validates: Requirements 5.9, 5.10**
    - **Property 12: Tag property extraction via dot notation** — Tags.K returns tag value V when present, undefined when absent
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 2.3 Create resource property mapper in `packages/backend/src/advisors/resource-property-mapper.ts`
    - Implement `mapEC2Properties`, `mapEBSProperties`, `mapSecurityGroupProperties`, `mapIAMUserProperties`, `mapIAMRoleProperties`, `mapLambdaProperties`, `mapRDSProperties`, `mapLoadBalancerProperties`
    - Each mapper returns a `PropertyMap` (Record<string, unknown>) with exactly the keys specified in Requirement 6
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ]* 2.4 Write property test for resource property mapper in `packages/backend/src/advisors/resource-property-mapper.test.ts`
    - **Property 11: Resource property mappers produce expected keys** — Each mapper produces a PropertyMap containing exactly the specified keys for that resource type
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8**

- [ ] 3. Checkpoint - Ensure shared types, validator, condition evaluator, and property mapper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [-] 4. Implement policy repository and CRUD API
  - [x] 4.1 Add policy CRUD methods to `packages/backend/src/repository.ts`
    - Implement `putPolicy(policy: GovernancePolicy): Promise<void>` using PK=`POLICY#<policyId>`, SK=`POLICY`
    - Implement `getPolicy(policyId: string): Promise<GovernancePolicy | undefined>`
    - Implement `listPolicies(): Promise<GovernancePolicy[]>` using begins_with scan on PK
    - Implement `deletePolicy(policyId: string): Promise<void>`
    - _Requirements: 1.1, 1.2_

  - [x] 4.2 Create policy API handlers in `packages/backend/src/api/policy-handlers.ts`
    - Implement `handleCreatePolicy` — validate via `validatePolicy`, generate UUID policyId, default `enabled=true`, set timestamps, persist, return 201
    - Implement `handleListPolicies` — return all policies as JSON array
    - Implement `handleGetPolicy` — return policy or 404
    - Implement `handleUpdatePolicy` — validate, update `updatedAt`, persist, return 200
    - Implement `handleDeletePolicy` — delete, return 200
    - Return 400 with validation errors array for invalid inputs
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 4.3 Add policy routes to `packages/backend/src/api/handlers.ts`
    - Import policy handler functions from `policy-handlers.ts`
    - Add route matching for `POST /policies`, `GET /policies`, `GET /policies/{policyId}`, `PUT /policies/{policyId}`, `DELETE /policies/{policyId}`
    - Follow existing if/else routing pattern
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.7_

  - [ ]* 4.4 Write property tests for policy API handlers in `packages/backend/src/api/policy-handlers.test.ts`
    - **Property 14: Policy create-then-read round trip** — Creating a valid policy and reading it back produces matching field values
    - **Validates: Requirements 2.1, 2.4**
    - **Property 15: Invalid policy inputs produce 400 with errors** — Invalid inputs to POST and PUT return 400 with non-empty error array
    - **Validates: Requirements 2.2, 2.8**
    - **Property 16: Enabled flag defaults to true** — Policy created without enabled field has enabled === true
    - **Validates: Requirements 1.3**

- [-] 5. Implement Governance Policy Engine and scan integration
  - [x] 5.1 Create GovernancePolicyEngine in `packages/backend/src/advisors/governance-policy-engine.ts`
    - Implement `GovernancePolicyEngine` class with `constructor(scanId: string)` and `async evaluate(input: PolicyEngineInput): Promise<PolicyEngineOutput>`
    - Load all enabled policies from DynamoDB via repository
    - Group policies by resourceType, query AWS resources per type in target account/region
    - Evaluate each policy condition against each resource using `evaluateCondition` and `extractPropertyValue`
    - Use resource property mappers to convert AWS SDK objects to flat PropertyMaps
    - Create `Recommendation` objects for violations with `advisorType: "GovernancePolicyEngine"`, `riskLevel` from policy severity, policy name in `issueDescription`, human-readable `suggestedAction`, `estimatedMonthlySavings: null`, `availableActions: []`, `dependencies: []`
    - Handle per-policy errors: catch, log, continue, aggregate into errors array
    - Handle DynamoDB load failure: record ScanError, return zero recommendations
    - Return `{ recommendations, resourcesEvaluated, errors }`
    - _Requirements: 4.1–4.8, 5.11, 9.1, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4_

  - [x] 5.2 Wire GovernancePolicyEngine into `packages/backend/src/orchestrator/invoke-advisors.ts`
    - Import `GovernancePolicyEngine`
    - Add a new try/catch block following the existing advisor pattern
    - Instantiate engine with scanId, call `evaluate` with accountId, region, crossAccountRoleArn
    - Persist recommendations via `repo.putRecommendations`
    - Aggregate resourcesEvaluated, recommendationCount, and errors
    - _Requirements: 4.1, 4.7_

  - [ ]* 5.3 Write property tests for GovernancePolicyEngine in `packages/backend/src/advisors/governance-policy-engine.test.ts`
    - **Property 13: Violation recommendations have correct structure invariants** — advisorType, riskLevel, issueDescription, suggestedAction, estimatedMonthlySavings, availableActions, dependencies all match spec
    - **Validates: Requirements 4.3, 4.4, 4.5, 9.1, 9.3, 9.4, 9.5, 9.6**
    - **Property 17: Only enabled policies are evaluated** — Disabled policies produce zero violations regardless of resource state
    - **Validates: Requirements 4.1**
    - **Property 18: Policy engine fault isolation** — If one policy throws, remaining N-1 policies still produce results and error is in output
    - **Validates: Requirements 4.7**

- [ ] 6. Checkpoint - Ensure backend policy engine and API tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement frontend Policy Editor and navigation
  - [x] 7.1 Add policy API client functions to `packages/frontend/src/api-client.ts`
    - Implement `getPolicies`, `getPolicy`, `createPolicy`, `updatePolicy`, `deletePolicy` functions
    - Follow existing API client patterns for fetch calls and error handling
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.7_

  - [x] 7.2 Create Policy Editor page in `packages/frontend/src/pages/PoliciesPage.tsx`
    - Policy list table showing name, resource type, severity, enabled/disabled toggle
    - Create/Edit form with fields: name, description, resource type dropdown, severity dropdown, condition (property dropdown, operator dropdown, value input)
    - Dynamic property dropdown that updates based on selected resource type using the resource property map
    - Delete confirmation dialog
    - Inline validation error display from API responses
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 7.3 Add Policies navigation and route to `packages/frontend/src/App.tsx`
    - Add "Policies" item to `navItems` array
    - Add route for PoliciesPage component
    - _Requirements: 8.8_

  - [ ]* 7.4 Write property test for Policy Editor in `packages/frontend/src/pages/PoliciesPage.test.tsx`
    - **Property 19: Property dropdown matches resource type property map** — For any resource type selected, the property dropdown contains exactly the properties defined for that type
    - **Validates: Requirements 8.3**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check library with minimum 100 iterations
- All property tests include `// Feature: custom-governance-policies, Property {N}: {title}` comment tags
