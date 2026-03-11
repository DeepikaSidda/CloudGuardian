import { useState, useEffect, useMemo } from "react";
import ReactFlow, {
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { getDependencySubgraph } from "../api-client";
import { getResourceTypeStyle } from "../utils/graph-styles";
import type {
  ResourceNode,
  DependencyEdge,
  GraphResourceType,
} from "@governance-engine/shared";

interface MiniDependencyGraphProps {
  resourceId: string;
  height?: number;
}

/**
 * Arrange nodes in a circular layout: center node in the middle,
 * dependencies evenly spaced around it.
 */
function circularLayout(
  centerId: string,
  nodes: ResourceNode[],
  width: number,
  height: number,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const cx = width / 2 - 60;
  const cy = height / 2 - 20;

  const others = nodes.filter((n) => n.resourceId !== centerId);
  positions[centerId] = { x: cx, y: cy };

  if (others.length === 0) return positions;

  const radius = Math.min(width, height) * 0.35;
  others.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
    positions[node.resourceId] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return positions;
}

function MiniDependencyGraph({ resourceId, height = 250 }: MiniDependencyGraphProps) {
  const [graphNodes, setGraphNodes] = useState<ResourceNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getDependencySubgraph(resourceId)
      .then((data) => {
        if (!cancelled) {
          setGraphNodes(data.nodes);
          setGraphEdges(data.edges);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGraphNodes([]);
          setGraphEdges([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [resourceId]);

  const { nodes, edges } = useMemo(() => {
    if (graphNodes.length === 0) return { nodes: [] as Node[], edges: [] as Edge[] };

    const positions = circularLayout(resourceId, graphNodes, 400, height);

    const rfNodes: Node[] = graphNodes.map((n) => {
      const style = getResourceTypeStyle(n.resourceType as GraphResourceType);
      const isCenter = n.resourceId === resourceId;
      return {
        id: n.resourceId,
        position: positions[n.resourceId] ?? { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: `${style.icon} ${n.displayName}` },
        style: {
          background: "var(--bg-card, #1e1e2e)",
          color: "var(--text-primary, #e0e0e0)",
          border: `2px solid ${style.color}`,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 500,
          boxShadow: isCenter ? `0 0 10px ${style.color}` : "none",
          opacity: 1,
          minWidth: 80,
        },
      };
    });

    const rfEdges: Edge[] = graphEdges.map((e) => ({
      id: `${e.sourceResourceId}-${e.targetResourceId}`,
      source: e.sourceResourceId,
      target: e.targetResourceId,
      label: e.relationshipLabel,
      labelStyle: { fontSize: 9, fill: "var(--text-secondary, #aaa)" },
      style: { stroke: "var(--text-secondary, #666)", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--text-secondary, #666)" },
    }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [graphNodes, graphEdges, resourceId, height]);

  if (loading) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary, #aaa)" }}>
        Loading dependencies…
      </div>
    );
  }

  if (graphNodes.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary, #aaa)" }}>
        No dependencies found
      </div>
    );
  }

  return (
    <div style={{ height, width: "100%", borderRadius: 8, overflow: "hidden", background: "var(--bg-card, #1e1e2e)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

export default MiniDependencyGraph;
