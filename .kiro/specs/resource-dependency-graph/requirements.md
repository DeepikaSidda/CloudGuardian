# Requirements Document

## Introduction

The Resource Dependency Graph feature extends the AWS Account Governance Engine (CloudGuardian) with the ability to discover, store, and visualize relationships between AWS resources. Users can explore an interactive graph showing how resources depend on each other (e.g., EC2 → Security Group → VPC), understand the blast radius before deleting or modifying a resource, and make safer cleanup decisions informed by dependency context.

## Glossary

- **Dependency_Graph_Builder**: The backend module responsible for discovering and constructing resource dependency relationships from AWS API data during a scan.
- **Graph_Store**: The persistence layer (DynamoDB) that stores resource nodes and their dependency edges.
- **Dependency_Graph_Page**: The frontend page that renders the interactive dependency graph visualization.
- **Blast_Radius_Calculator**: The module that computes the set of transitively affected resources when a given resource is selected for deletion or modification.
- **Resource_Node**: A single AWS resource represented as a node in the dependency graph, containing its resource ID, type, account, and region.
- **Dependency_Edge**: A directed relationship between two Resource_Nodes indicating that one resource depends on or is associated with another.
- **Recommendation_Detail_Page**: The existing page that shows details of a recommendation, including suggested actions.

## Requirements

### Requirement 1: Discover EC2 Resource Dependencies

**User Story:** As a cloud operator, I want the system to automatically discover relationships between EC2 instances and their associated resources, so that I can understand what is connected before making changes.

#### Acceptance Criteria

1. WHEN a scan completes, THE Dependency_Graph_Builder SHALL discover relationships between EC2 instances and their Security Groups, Subnets, VPCs, EBS Volumes, Elastic IPs, and IAM Instance Profiles.
2. WHEN a Security Group is discovered, THE Dependency_Graph_Builder SHALL identify the VPC that contains the Security Group.
3. WHEN a Subnet is discovered, THE Dependency_Graph_Builder SHALL identify the VPC that contains the Subnet.
4. THE Dependency_Graph_Builder SHALL represent each discovered relationship as a Dependency_Edge with a human-readable relationship label (e.g., "attached to", "member of", "launched in").

### Requirement 2: Discover Lambda, ECS, and RDS Resource Dependencies

**User Story:** As a cloud operator, I want the system to discover dependencies for Lambda functions, ECS services, and RDS instances, so that I have a complete picture of resource relationships.

#### Acceptance Criteria

1. WHEN a scan completes, THE Dependency_Graph_Builder SHALL discover relationships between Lambda functions and their IAM execution roles, VPC configurations (Subnets and Security Groups), and event source mappings.
2. WHEN a scan completes, THE Dependency_Graph_Builder SHALL discover relationships between ECS services and their ECS clusters, task definitions, IAM task roles, and associated Load Balancers.
3. WHEN a scan completes, THE Dependency_Graph_Builder SHALL discover relationships between RDS instances and their Subnet Groups, Security Groups, and IAM roles used for monitoring or S3 integration.
4. WHEN a scan completes, THE Dependency_Graph_Builder SHALL discover relationships between Load Balancers and their target groups, Security Groups, and Subnets.

### Requirement 3: Store Dependency Graph Data

**User Story:** As a cloud operator, I want dependency data to persist across sessions, so that I can view the graph without re-scanning.

#### Acceptance Criteria

1. THE Graph_Store SHALL persist each Resource_Node with its resource ID, resource type, account ID, region, and a human-readable display name.
2. THE Graph_Store SHALL persist each Dependency_Edge with a source resource ID, target resource ID, and a relationship label.
3. THE Graph_Store SHALL associate all Resource_Nodes and Dependency_Edges with the scan ID that produced them.
4. WHEN a new scan completes, THE Graph_Store SHALL replace the previous dependency graph data for the same account and region with the new scan results.
5. IF the Dependency_Graph_Builder encounters an error discovering dependencies for a specific resource, THEN THE Graph_Store SHALL store the successfully discovered nodes and edges and log the error without discarding the entire graph.

### Requirement 4: Dependency Graph API

**User Story:** As a frontend developer, I want API endpoints to retrieve dependency graph data, so that the frontend can render the graph visualization.

#### Acceptance Criteria

1. WHEN a GET request is made to the dependency graph endpoint, THE API SHALL return all Resource_Nodes and Dependency_Edges for the most recent completed scan.
2. WHEN a GET request includes an optional resource ID parameter, THE API SHALL return the subgraph containing the specified resource and all resources within two edges of the specified resource.
3. WHEN a GET request includes an optional resource type filter, THE API SHALL return only Resource_Nodes matching the specified type and their connected Dependency_Edges.
4. IF no dependency graph data exists for the requested scan, THEN THE API SHALL return an empty graph structure with zero nodes and zero edges.

### Requirement 5: Interactive Graph Visualization

**User Story:** As a cloud operator, I want to see an interactive visual graph of resource dependencies, so that I can quickly understand how resources are connected.

#### Acceptance Criteria

1. THE Dependency_Graph_Page SHALL render Resource_Nodes as labeled nodes positioned using a force-directed layout algorithm.
2. THE Dependency_Graph_Page SHALL render Dependency_Edges as directed lines between connected nodes, with the relationship label visible on hover.
3. THE Dependency_Graph_Page SHALL use distinct visual styles (color and icon) for each resource type to differentiate EC2 instances, Security Groups, VPCs, Subnets, Lambda functions, IAM roles, ECS services, RDS instances, Load Balancers, NAT Gateways, and EBS Volumes.
4. WHEN a user clicks on a Resource_Node, THE Dependency_Graph_Page SHALL highlight the selected node and all directly connected nodes and edges.
5. THE Dependency_Graph_Page SHALL support panning and zooming to navigate large graphs.
6. THE Dependency_Graph_Page SHALL provide a filter panel that allows filtering nodes by resource type, account ID, and region.

### Requirement 6: Blast Radius Calculation and Display

**User Story:** As a cloud operator, I want to see the blast radius of deleting a resource, so that I understand the full impact before taking action.

#### Acceptance Criteria

1. WHEN a user selects a Resource_Node on the Dependency_Graph_Page, THE Blast_Radius_Calculator SHALL compute all resources that are transitively dependent on the selected resource.
2. THE Dependency_Graph_Page SHALL visually distinguish blast radius resources from unaffected resources using color coding (e.g., red for affected, grey for unaffected).
3. THE Dependency_Graph_Page SHALL display a summary panel showing the count of affected resources grouped by resource type when a blast radius is active.
4. IF a selected resource has zero dependent resources, THEN THE Dependency_Graph_Page SHALL display a message indicating the resource can be safely removed with no downstream impact.

### Requirement 7: Integration with Existing Recommendations

**User Story:** As a cloud operator, I want to see dependency context on recommendation detail pages, so that I can make informed decisions before executing cleanup actions.

#### Acceptance Criteria

1. WHEN a user views a recommendation on the Recommendation_Detail_Page, THE Recommendation_Detail_Page SHALL display a mini dependency graph showing the recommended resource and its direct dependencies.
2. WHEN a user is about to execute an action (stop, delete, terminate, release) from the Recommendation_Detail_Page, THE Recommendation_Detail_Page SHALL display the blast radius summary for the target resource.
3. IF the blast radius contains one or more dependent resources, THEN THE Recommendation_Detail_Page SHALL require the user to acknowledge the blast radius before proceeding with the action.
4. THE Dependency_Graph_Builder SHALL populate the existing `dependencies` field on Recommendation objects with the discovered Dependency_Edges for each recommended resource.

### Requirement 8: Navigation Between Graph and Recommendations

**User Story:** As a cloud operator, I want to navigate between the dependency graph and recommendations, so that I can move fluidly between understanding dependencies and taking action.

#### Acceptance Criteria

1. WHEN a user clicks on a Resource_Node that has an associated recommendation, THE Dependency_Graph_Page SHALL display a link to the corresponding recommendation detail page.
2. WHEN a user views a recommendation with dependencies, THE Recommendation_Detail_Page SHALL display a link to view the full dependency graph centered on the recommended resource.
