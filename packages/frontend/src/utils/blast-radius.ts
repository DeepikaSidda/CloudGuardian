import type { ResourceNode, DependencyEdge, BlastRadiusResult } from "@governance-engine/shared";

/**
 * Calculates the blast radius for a selected resource by performing BFS
 * traversal following outgoing dependency edges transitively.
 *
 * The selected resource itself is NOT included in the affected nodes.
 * If the selected resource has no outgoing edges, returns an empty result.
 */
export function calculateBlastRadius(
  graph: { nodes: ResourceNode[]; edges: DependencyEdge[] },
  selectedResourceId: string
): BlastRadiusResult {
  // Build adjacency map: source → [target resource IDs]
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.sourceResourceId);
    if (targets) {
      targets.push(edge.targetResourceId);
    } else {
      adjacency.set(edge.sourceResourceId, [edge.targetResourceId]);
    }
  }

  // If no outgoing edges from the selected resource, return empty result
  if (!adjacency.has(selectedResourceId)) {
    return { affectedNodes: [], affectedByType: {}, totalAffected: 0 };
  }

  // BFS traversal from the selected resource
  const visited = new Set<string>();
  visited.add(selectedResourceId);
  const queue: string[] = [...(adjacency.get(selectedResourceId) ?? [])];

  for (const id of queue) {
    visited.add(id);
  }

  let i = 0;
  while (i < queue.length) {
    const current = queue[i++];
    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Remove the selected resource from visited set — it shouldn't be in affected nodes
  visited.delete(selectedResourceId);

  // Build a lookup map for nodes by resourceId
  const nodeMap = new Map<string, ResourceNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.resourceId, node);
  }

  // Collect affected nodes and compute per-type counts
  const affectedNodes: ResourceNode[] = [];
  const affectedByType: Record<string, number> = {};

  for (const id of visited) {
    const node = nodeMap.get(id);
    if (node) {
      affectedNodes.push(node);
      affectedByType[node.resourceType] = (affectedByType[node.resourceType] ?? 0) + 1;
    }
  }

  return {
    affectedNodes,
    affectedByType,
    totalAffected: affectedNodes.length,
  };
}
