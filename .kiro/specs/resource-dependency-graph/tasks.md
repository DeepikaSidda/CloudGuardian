# Implementation Plan: Resource Dependency Graph

## Overview

Incrementally build the dependency graph feature starting with shared types, then backend discovery and persistence, API endpoints, frontend visualization, blast radius calculation, and finally integration with existing recommendation pages. Each task builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Define shared types and extend existing type definitions
  - [x] 1.1 Add graph-related types to `packages/shared/src/types.ts`
    - Add `GraphResourceType` union extending `ResourceType` with `VPC`, `Subnet`, `SubnetGroup`, `TargetGroup`, `ECSCluster`, `ElasticIP`
    - Add `ResourceNode` interface with `resourceId`, `resourceType`, `accountId`, `region`, `displayName`
    - Add `DependencyEdge` interface with `sourceResourceId`, `targetResourceId`, `relationshipLabel`
    - Add `DependencyGraph` interface with `scanId`, `nodes`, `edges`
    - Add `GraphDiscoveryError` interface with `resourceType`, `errorCode`, `errorMessage`
    - Add `DependencyGraphResponse` interface for API responses
    - Add `BlastRadiusResult` interface with `affectedNodes`, `affectedByType`, `totalAffected`
    - _Requirements: 1.4, 3.1, 3.2, 4.1, 6.1, 6.3_

- [x] 2. Implement repository extensions for graph persistence
  - [x] 2.1 Add graph storage methods to `packages/backend/src/repository.ts`
    - Implement `putGraphNodes(scanId, nodes)` using `BatchWriteItem` with PK `GRAPH#<scanId>` / SK `NODE#<resourceId>`
    - Implement `putGraphEdges(scanId, edges)` using `BatchWriteItem` with PK `GRAPH#<scanId>` / SK `EDGE#<sourceId>#<targetId>`
    - Implement `putGraphMeta(accountId, region, scanId)` to upsert the `GRAPHMETA#<accountId>#<region>` / `LATEST` record
    - Implement `getGraph(scanId)` querying PK `GRAPH#<scanId>` and separating NODE/EDGE items
    - Implement `getSubgraph(scanId, resourceId, depth)` performing BFS on stored edges up to `depth` hops
    - Implement `getLatestGraphScanId(accountId, region)` reading the GRAPHMETA record
    - Implement `deleteGraph(scanId)` removing all items with PK `GRAPH#<scanId>`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2_

  - [ ]* 2.2 Write property test: Graph persistence round-trip (Property 3)
    - **Property 3: Graph persistence round-trip**
    - Generate random `ResourceNode[]` and `DependencyEdge[]`, store via `putGraphNodes`/`putGraphEdges`, retrieve via `getGraph`, verify equivalence
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1**

  - [ ]* 2.3 Write property test: Graph replacement on new scan (Property 4)
    - **Property 4: Graph replacement on new scan**
    - Generate two random graphs for the same account/region, store sequentially, verify `getLatestGraphScanId` returns only the second scan's data
    - **Validates: Requirements 3.4**

  - [ ]* 2.4 Write property test: Subgraph BFS correctness (Property 5)
    - **Property 5: Subgraph BFS correctness**
    - Generate random graphs and random node selections, verify `getSubgraph` returns exactly the nodes reachable within N hops
    - **Validates: Requirements 4.2**

- [x] 3. Implement DependencyGraphBuilder for resource discovery
  - [x] 3.1 Create `packages/backend/src/dependency-graph/builder.ts`
    - Implement `DependencyGraphBuilder` class with `discover(input: DiscoverInput): Promise<DiscoverOutput>`
    - Implement `discoverEC2Dependencies` discovering EC2 → SecurityGroup, Subnet, EBSVolume, ElasticIP, IAMRole relationships
    - Implement SecurityGroup → VPC and Subnet → VPC relationships within EC2 discovery
    - Use relationship labels from the design's label table
    - Wrap each discovery method in try/catch, collect errors in `GraphDiscoveryError[]`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.5_

  - [x] 3.2 Add Lambda, ECS, RDS, and Load Balancer discovery to builder
    - Implement `discoverLambdaDependencies` for Lambda → IAMRole, Subnet, SecurityGroup
    - Implement `discoverECSDependencies` for ECSService → ECSCluster, IAMRole, LoadBalancer
    - Implement `discoverRDSDependencies` for RDSInstance → SecurityGroup, SubnetGroup, IAMRole
    - Implement `discoverLoadBalancerDependencies` for LoadBalancer → TargetGroup, SecurityGroup, Subnet
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.3 Write property test: Discovery completeness (Property 1)
    - **Property 1: Discovery completeness**
    - Generate random AWS resource configurations with known associations using mocked SDK clients, verify all expected edges are produced
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4**

  - [ ]* 3.4 Write property test: Edge label invariant (Property 2)
    - **Property 2: Edge label invariant**
    - Generate random discovery outputs, verify every `DependencyEdge.relationshipLabel` is a non-empty string
    - **Validates: Requirements 1.4**

- [x] 4. Integrate builder into scan pipeline and persist results
  - [x] 4.1 Wire DependencyGraphBuilder into `packages/backend/src/orchestrator/invoke-advisors.ts`
    - After advisors complete, instantiate `DependencyGraphBuilder` and call `discover()`
    - Store resulting nodes and edges via repository `putGraphNodes`/`putGraphEdges`
    - Update graph metadata via `putGraphMeta`
    - Log any `GraphDiscoveryError` entries and continue scan completion
    - _Requirements: 1.1, 2.1, 3.3, 3.4, 3.5_

  - [ ]* 4.2 Write property test: Recommendation dependencies populated (Property 10)
    - **Property 10: Recommendation dependencies populated**
    - Generate random recommendations and graph edges, verify the `dependencies` field on each Recommendation is populated with matching edges
    - **Validates: Requirements 7.4**

- [x] 5. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement API endpoints for dependency graph
  - [x] 6.1 Add dependency graph route handler to `packages/backend/src/api/handlers.ts`
    - Implement `handleGetDependencyGraph` for `GET /dependency-graph`
    - Support optional `resourceId` query param to return subgraph (depth 2)
    - Support optional `resourceType` query param to filter nodes by type and include connected edges
    - Return empty graph `{ scanId: "", nodes: [], edges: [] }` when no data exists
    - Return `400` for invalid `resourceType` values
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 6.2 Write property test: Type filter correctness (Property 6)
    - **Property 6: Type filter correctness**
    - Generate random graphs and random type filters, verify all returned nodes match the filter and all returned edges have at least one matching endpoint
    - **Validates: Requirements 4.3, 5.6**

  - [x] 6.3 Add API client functions to `packages/frontend/src/api-client.ts`
    - Add `getDependencyGraph()` function to fetch full graph
    - Add `getDependencySubgraph(resourceId: string)` function to fetch subgraph
    - _Requirements: 4.1, 4.2_

- [x] 7. Implement blast radius calculator
  - [x] 7.1 Create `packages/frontend/src/utils/blast-radius.ts`
    - Implement `calculateBlastRadius(graph, selectedResourceId): BlastRadiusResult`
    - Use BFS traversal following outgoing dependency edges transitively
    - Return `affectedNodes`, `affectedByType` (count per resource type), and `totalAffected`
    - Return empty result for nodes with no outgoing edges
    - _Requirements: 6.1, 6.3, 6.4_

  - [ ]* 7.2 Write property test: Blast radius transitivity (Property 7)
    - **Property 7: Blast radius transitivity**
    - Generate random directed graphs and random start nodes, verify BFS result matches expected reachable set, excluding the start node
    - **Validates: Requirements 6.1, 5.4, 6.4**

  - [ ]* 7.3 Write property test: Blast radius grouping consistency (Property 8)
    - **Property 8: Blast radius grouping consistency**
    - Generate random blast radius results, verify sum of `affectedByType` counts equals `totalAffected` and per-type counts match actual node counts
    - **Validates: Requirements 6.3**

- [x] 8. Implement DependencyGraphPage with interactive visualization
  - [x] 8.1 Create resource type style mapping utility
    - Create a style mapping function in `packages/frontend/src/utils/graph-styles.ts`
    - Map each `GraphResourceType` to a distinct color and icon
    - _Requirements: 5.3_

  - [ ]* 8.2 Write property test: Distinct resource type styles (Property 9)
    - **Property 9: Distinct resource type styles**
    - Verify all pairs of distinct `GraphResourceType` values produce different color values
    - **Validates: Requirements 5.3**

  - [x] 8.3 Create `packages/frontend/src/pages/DependencyGraphPage.tsx`
    - Fetch graph data via `getDependencyGraph()` on mount
    - Render nodes using React Flow with force-directed layout
    - Apply resource type styles (color/icon) to nodes
    - Render directed edges with relationship labels visible on hover
    - Implement node click to highlight selected node and directly connected nodes/edges
    - Implement blast radius display: color affected nodes red, unaffected grey
    - Show blast radius summary panel with per-type counts when a node is selected
    - Show "safe to remove" message when selected node has zero dependents
    - Add filter panel for resource type, account ID, and region
    - Support pan and zoom via React Flow built-in controls
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_

  - [x] 8.4 Add route and navigation for DependencyGraphPage
    - Add `/dependency-graph` route to `packages/frontend/src/App.tsx`
    - Add navigation item to the app's nav menu
    - _Requirements: 5.1_

- [x] 9. Integrate dependency context into Recommendation Detail Page
  - [x] 9.1 Create `packages/frontend/src/components/MiniDependencyGraph.tsx`
    - Compact React Flow graph showing a single resource and its direct dependencies
    - Accept `resourceId` prop, fetch subgraph via `getDependencySubgraph`
    - _Requirements: 7.1_

  - [x] 9.2 Extend `packages/frontend/src/pages/RecommendationDetailPage.tsx`
    - Embed `MiniDependencyGraph` component showing the recommended resource's dependencies
    - Display blast radius summary before action execution (stop, delete, terminate, release)
    - Require user acknowledgment if blast radius contains dependent resources
    - Add link to full dependency graph page centered on the recommended resource
    - _Requirements: 7.1, 7.2, 7.3, 8.2_

  - [x] 9.3 Add recommendation link on DependencyGraphPage nodes
    - When a node has an associated recommendation, show a link to the recommendation detail page on node click
    - _Requirements: 8.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The project uses `fast-check` (v3.23.0) for property-based testing
- React Flow is used for graph visualization with built-in pan/zoom support
