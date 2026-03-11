# Requirements Document

## Introduction

Custom Governance Policies allows CloudGuardian users to define declarative compliance rules for their AWS resources (e.g., "No EC2 instances larger than t3.medium", "All S3 buckets must have versioning enabled"). These policies are evaluated automatically during scans alongside the existing advisors (SafeCleanupAdvisor, PermissionDriftDetector, ZombieResourceDetector). Violations surface as recommendations in the existing recommendations system, giving users a unified view of both automated findings and custom compliance checks.

## Glossary

- **Policy**: A user-defined governance rule that specifies a condition to check against a specific AWS resource type. A Policy has a name, description, target resource type, condition, severity, and enabled/disabled status.
- **Policy_Engine**: The backend component that evaluates all enabled policies against discovered AWS resources during a scan and produces recommendations for violations.
- **Policy_API**: The set of REST API endpoints that handle CRUD operations for governance policies.
- **Policy_Editor**: The frontend UI component that allows users to create, edit, enable/disable, and delete governance policies.
- **Condition**: A structured rule within a Policy that defines what property to check, what operator to apply, and what value to compare against (e.g., property: "InstanceType", operator: "not_in", value: ["t3.micro", "t3.small", "t3.medium"]).
- **Policy_Validator**: The shared module that validates Policy definitions for structural correctness before they are persisted.
- **Scan_Orchestrator**: The existing Step Functions workflow (discover-accounts → invoke-advisors → complete-scan) that coordinates governance scans.
- **Recommendation**: The existing data structure used by CloudGuardian to represent a finding, including resource ID, risk level, suggested action, and advisor type.

## Requirements

### Requirement 1: Policy Data Model and Storage

**User Story:** As a CloudGuardian user, I want governance policies to be stored persistently, so that my custom rules survive across scans and application restarts.

#### Acceptance Criteria

1. THE Policy_API SHALL store each Policy as a DynamoDB item with a unique policyId, name, description, enabled flag, target resourceType, condition, severity (Low, Medium, High), createdAt timestamp, and updatedAt timestamp.
2. THE Policy_API SHALL generate a unique policyId (UUID) for each new Policy at creation time.
3. WHEN a Policy is created without an explicit enabled flag, THE Policy_API SHALL default the enabled flag to true.
4. THE Policy_Validator SHALL accept only resourceType values that exist in the CloudGuardian ResourceType union (EC2Instance, EBSVolume, ElasticIP, LoadBalancer, SecurityGroup, IAMUser, IAMRole, LambdaFunction, RDSInstance, ECSService, NATGateway, CloudWatchLogGroup).
5. THE Policy_Validator SHALL accept only the following condition operators: "equals", "not_equals", "greater_than", "less_than", "in", "not_in", "contains", "not_contains", "exists", "not_exists".

### Requirement 2: Policy CRUD API

**User Story:** As a CloudGuardian user, I want to create, read, update, and delete governance policies through the API, so that I can manage my compliance rules programmatically.

#### Acceptance Criteria

1. WHEN a POST request is sent to /policies with a valid Policy body, THE Policy_API SHALL create the Policy and return the created Policy with a 201 status code.
2. WHEN a POST request is sent to /policies with an invalid Policy body, THE Policy_API SHALL return a 400 status code with a list of validation errors.
3. WHEN a GET request is sent to /policies, THE Policy_API SHALL return all stored policies as a JSON array.
4. WHEN a GET request is sent to /policies/{policyId} with a valid policyId, THE Policy_API SHALL return the matching Policy.
5. WHEN a GET request is sent to /policies/{policyId} with a non-existent policyId, THE Policy_API SHALL return a 404 status code.
6. WHEN a PUT request is sent to /policies/{policyId} with a valid body, THE Policy_API SHALL update the Policy and return the updated Policy.
7. WHEN a DELETE request is sent to /policies/{policyId}, THE Policy_API SHALL remove the Policy and return a 200 status code.
8. WHEN a PUT request is sent to /policies/{policyId} with an invalid body, THE Policy_API SHALL return a 400 status code with validation errors.

### Requirement 3: Policy Validation

**User Story:** As a CloudGuardian user, I want my policy definitions validated before saving, so that only well-formed rules are stored and evaluated.

#### Acceptance Criteria

1. THE Policy_Validator SHALL reject a Policy that has an empty or missing name field and return an error message identifying the missing field.
2. THE Policy_Validator SHALL reject a Policy that has an unsupported resourceType and return an error message listing the valid resource types.
3. THE Policy_Validator SHALL reject a Policy whose condition has an unsupported operator and return an error message listing the valid operators.
4. THE Policy_Validator SHALL reject a Policy whose condition is missing the property field.
5. WHEN a condition uses the "greater_than" or "less_than" operator, THE Policy_Validator SHALL reject the Policy if the condition value is not a number.
6. WHEN a condition uses the "in" or "not_in" operator, THE Policy_Validator SHALL reject the Policy if the condition value is not an array.
7. THE Policy_Validator SHALL return all validation errors in a single response rather than stopping at the first error.
8. FOR ALL valid Policy objects, serializing to JSON then deserializing back SHALL produce an equivalent Policy object (round-trip property).

### Requirement 4: Policy Evaluation During Scans

**User Story:** As a CloudGuardian user, I want my custom policies evaluated automatically during scans, so that I get compliance findings without manual effort.

#### Acceptance Criteria

1. WHEN the Scan_Orchestrator invokes advisors, THE Policy_Engine SHALL load all enabled policies from DynamoDB.
2. WHEN the Policy_Engine evaluates a Policy, THE Policy_Engine SHALL query the target AWS resource type in the scanned account and region.
3. WHEN a resource violates a Policy condition, THE Policy_Engine SHALL create a Recommendation with advisorType set to "GovernancePolicyEngine".
4. WHEN a resource violates a Policy condition, THE Policy_Engine SHALL set the Recommendation riskLevel to the severity defined in the violated Policy.
5. WHEN a resource violates a Policy condition, THE Policy_Engine SHALL include the Policy name and the specific violation detail in the Recommendation issueDescription.
6. WHEN no enabled policies exist, THE Policy_Engine SHALL skip evaluation and return zero recommendations with zero errors.
7. IF the Policy_Engine fails to evaluate a single Policy, THEN THE Policy_Engine SHALL log the error, continue evaluating remaining policies, and include the error in the scan errors array.
8. THE Policy_Engine SHALL report the total number of resources evaluated and the number of violations found, consistent with the existing advisor output format.

### Requirement 5: Condition Evaluation Logic

**User Story:** As a CloudGuardian user, I want flexible condition operators, so that I can express a variety of compliance rules for different resource properties.

#### Acceptance Criteria

1. WHEN the operator is "equals", THE Policy_Engine SHALL flag a violation if the resource property value does not equal the condition value.
2. WHEN the operator is "not_equals", THE Policy_Engine SHALL flag a violation if the resource property value equals the condition value.
3. WHEN the operator is "greater_than", THE Policy_Engine SHALL flag a violation if the numeric resource property value exceeds the condition value.
4. WHEN the operator is "less_than", THE Policy_Engine SHALL flag a violation if the numeric resource property value is below the condition value.
5. WHEN the operator is "in", THE Policy_Engine SHALL flag a violation if the resource property value is not contained in the condition value array.
6. WHEN the operator is "not_in", THE Policy_Engine SHALL flag a violation if the resource property value is contained in the condition value array.
7. WHEN the operator is "contains", THE Policy_Engine SHALL flag a violation if the resource property value (string or array) does not contain the condition value.
8. WHEN the operator is "not_contains", THE Policy_Engine SHALL flag a violation if the resource property value (string or array) contains the condition value.
9. WHEN the operator is "exists", THE Policy_Engine SHALL flag a violation if the resource property is undefined or null.
10. WHEN the operator is "not_exists", THE Policy_Engine SHALL flag a violation if the resource property is defined and not null.
11. IF a resource property referenced by a condition does not exist on the resource, THEN THE Policy_Engine SHALL treat the property value as undefined for operator evaluation.


### Requirement 6: Supported Resource Property Mappings

**User Story:** As a CloudGuardian user, I want to write conditions against meaningful resource properties, so that I can express real-world compliance rules without knowing AWS API internals.

#### Acceptance Criteria

1. WHEN evaluating EC2Instance policies, THE Policy_Engine SHALL expose the properties: InstanceType, State, PublicIpAddress, Tags, VpcId, SubnetId, ImageId, LaunchTime.
2. WHEN evaluating S3-related policies via EBSVolume resource type, THE Policy_Engine SHALL expose the properties: VolumeType, Size, State, Encrypted, Iops.
3. WHEN evaluating SecurityGroup policies, THE Policy_Engine SHALL expose the properties: GroupName, VpcId, InboundRuleCount, OutboundRuleCount, Tags.
4. WHEN evaluating IAMUser policies, THE Policy_Engine SHALL expose the properties: UserName, MfaEnabled, AccessKeyAge, PasswordLastUsed, Tags.
5. WHEN evaluating IAMRole policies, THE Policy_Engine SHALL expose the properties: RoleName, LastUsedDate, AttachedPolicyCount, Tags.
6. WHEN evaluating LambdaFunction policies, THE Policy_Engine SHALL expose the properties: Runtime, MemorySize, Timeout, CodeSize, LastModified, Tags.
7. WHEN evaluating RDSInstance policies, THE Policy_Engine SHALL expose the properties: DBInstanceClass, Engine, MultiAZ, StorageEncrypted, PubliclyAccessible, Tags.
8. WHEN evaluating LoadBalancer policies, THE Policy_Engine SHALL expose the properties: Type, Scheme, State, Tags.

### Requirement 7: Tag-Based Policy Conditions

**User Story:** As a CloudGuardian user, I want to enforce tagging standards across my resources, so that I can maintain consistent resource organization and cost allocation.

#### Acceptance Criteria

1. WHEN the condition property starts with "Tags.", THE Policy_Engine SHALL extract the tag value using the portion after "Tags." as the tag key (e.g., "Tags.Environment" checks the "Environment" tag).
2. WHEN the condition property starts with "Tags." and the operator is "exists", THE Policy_Engine SHALL flag a violation if the specified tag key is not present on the resource.
3. WHEN the condition property starts with "Tags." and the operator is "in", THE Policy_Engine SHALL flag a violation if the tag value is not in the specified list of allowed values.
4. IF a resource does not support tags, THEN THE Policy_Engine SHALL treat all tag properties as undefined.

### Requirement 8: Policy Editor UI

**User Story:** As a CloudGuardian user, I want a visual interface to create and manage governance policies, so that I can define compliance rules without writing code.

#### Acceptance Criteria

1. THE Policy_Editor SHALL display a list of all policies showing name, resource type, severity, and enabled/disabled status.
2. WHEN the user clicks "Create Policy", THE Policy_Editor SHALL display a form with fields for name, description, resource type (dropdown), severity (dropdown), and condition (property, operator, value).
3. WHEN the user selects a resource type in the form, THE Policy_Editor SHALL update the property dropdown to show only properties valid for that resource type.
4. WHEN the user submits a valid policy form, THE Policy_Editor SHALL call the Policy_API to create the policy and add the new policy to the displayed list.
5. WHEN the user toggles a policy's enabled status, THE Policy_Editor SHALL call the Policy_API to update the policy and reflect the change in the list.
6. WHEN the user clicks delete on a policy, THE Policy_Editor SHALL prompt for confirmation before calling the Policy_API to delete the policy.
7. WHEN the Policy_API returns validation errors, THE Policy_Editor SHALL display the errors inline next to the relevant form fields.
8. THE Policy_Editor SHALL be accessible from the main navigation as a "Policies" menu item.

### Requirement 9: Policy Violation Recommendations Integration

**User Story:** As a CloudGuardian user, I want policy violations to appear in the existing recommendations view, so that I have a single place to review all governance findings.

#### Acceptance Criteria

1. THE Policy_Engine SHALL produce Recommendation objects that conform to the existing Recommendation interface, including scanId, accountId, region, resourceId, resourceType, issueDescription, suggestedAction, riskLevel, explanation, and createdAt.
2. WHEN the recommendations list is filtered by advisorType, THE Recommendation list SHALL support filtering by "GovernancePolicyEngine" to show only policy violations.
3. THE Policy_Engine SHALL set the suggestedAction field to a human-readable remediation instruction derived from the Policy condition (e.g., "Change InstanceType to a value in [t3.micro, t3.small, t3.medium]").
4. THE Policy_Engine SHALL set estimatedMonthlySavings to null for policy violation recommendations.
5. THE Policy_Engine SHALL set availableActions to an empty array for policy violation recommendations.
6. THE Policy_Engine SHALL set dependencies to an empty array for policy violation recommendations.

### Requirement 10: Policy Evaluation Error Handling

**User Story:** As a CloudGuardian user, I want clear feedback when policy evaluation encounters problems, so that I can troubleshoot and fix my policies.

#### Acceptance Criteria

1. IF the Policy_Engine cannot access a resource type in a given region (e.g., permission denied), THEN THE Policy_Engine SHALL record a ScanError with the accountId, region, resourceType, errorCode, and a descriptive errorMessage.
2. IF a Policy condition references a property that does not exist on any resource of the target type, THEN THE Policy_Engine SHALL evaluate the condition using undefined as the property value rather than raising an error.
3. IF the Policy_Engine fails to load policies from DynamoDB, THEN THE Policy_Engine SHALL record a ScanError and return zero recommendations rather than failing the entire scan.
4. WHEN the Policy_Engine completes evaluation, THE Policy_Engine SHALL include all errors in the output errors array alongside errors from other advisors.
