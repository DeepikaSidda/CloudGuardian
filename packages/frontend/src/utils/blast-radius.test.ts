import { calculateBlastRadius } from "./blast-radius";
import type { ResourceNode, DependencyEdge, GraphResourceType } from "@governance-engine/shared";

function makeNode(id: string, type: GraphResourceType = "EC2Instance"): ResourceNode {
  return {
    resourceId: id,
    resourceType: type,
    accountId: "111222333444",
    region: "us-east-1",
    displayName: id,
  };
}

function makeEdge(source: string, target: string, label = "depends on"): DependencyEdge {
  return { sourceResourceId: source, targetResourceId: target, relationshipLabel: label };
}

describe("calculateBlastRadius", () => {
  it("returns empty result for a node with no outgoing edges", () => {
    const graph = {
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("b", "a")],
    };
    const result = calculateBlastRadius(graph, "a");
    expect(result).toEqual({ affectedNodes: [], affectedByType: {}, totalAffected: 0 });
  });

  it("returns empty result when selectedResourceId is not in the graph", () => {
    const graph = {
      nodes: [makeNode("a")],
      edges: [],
    };
    const result = calculateBlastRadius(graph, "nonexistent");
    expect(result).toEqual({ affectedNodes: [], affectedByType: {}, totalAffected: 0 });
  });

  it("returns direct dependents for a single-hop graph", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("a", "c")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.totalAffected).toBe(2);
    expect(result.affectedNodes.map((n) => n.resourceId).sort()).toEqual(["b", "c"]);
  });

  it("follows transitive dependencies via BFS", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("c", "d")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.totalAffected).toBe(3);
    expect(result.affectedNodes.map((n) => n.resourceId).sort()).toEqual(["b", "c", "d"]);
  });

  it("does not include the selected resource in affected nodes", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("a", "b")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.affectedNodes.every((n) => n.resourceId !== "a")).toBe(true);
  });

  it("handles cycles without infinite loops", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("c", "a")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.totalAffected).toBe(2);
    expect(result.affectedNodes.map((n) => n.resourceId).sort()).toEqual(["b", "c"]);
  });

  it("computes affectedByType correctly", () => {
    const nodes = [
      makeNode("a", "EC2Instance"),
      makeNode("b", "SecurityGroup"),
      makeNode("c", "SecurityGroup"),
      makeNode("d", "VPC"),
    ];
    const edges = [makeEdge("a", "b"), makeEdge("a", "c"), makeEdge("b", "d")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.affectedByType).toEqual({ SecurityGroup: 2, VPC: 1 });
    expect(result.totalAffected).toBe(3);
  });

  it("handles empty graph", () => {
    const result = calculateBlastRadius({ nodes: [], edges: [] }, "a");
    expect(result).toEqual({ affectedNodes: [], affectedByType: {}, totalAffected: 0 });
  });

  it("does not follow incoming edges (only outgoing)", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    // b → a (incoming to a) and a → c (outgoing from a)
    const edges = [makeEdge("b", "a"), makeEdge("a", "c")];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.totalAffected).toBe(1);
    expect(result.affectedNodes[0].resourceId).toBe("c");
  });

  it("handles diamond-shaped dependencies without duplicates", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
    const edges = [
      makeEdge("a", "b"),
      makeEdge("a", "c"),
      makeEdge("b", "d"),
      makeEdge("c", "d"),
    ];
    const result = calculateBlastRadius({ nodes, edges }, "a");

    expect(result.totalAffected).toBe(3);
    expect(result.affectedNodes.map((n) => n.resourceId).sort()).toEqual(["b", "c", "d"]);
  });
});
