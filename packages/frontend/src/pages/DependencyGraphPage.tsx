import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Handle,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { getDependencyGraph, getRecommendations } from "../api-client";
import { calculateBlastRadius } from "../utils/blast-radius";
import { getResourceTypeStyle, RESOURCE_TYPE_STYLES } from "../utils/graph-styles";
import type {
  ResourceNode,
  DependencyEdge,
  GraphResourceType,
  BlastRadiusResult,
  Recommendation,
} from "@governance-engine/shared";
import LoadingSpinner from "../components/LoadingSpinner";

// ── Force-directed layout (simple simulation) ─────────────────────────

function forceDirectedLayout(
  graphNodes: ResourceNode[],
  graphEdges: DependencyEdge[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (graphNodes.length === 0) return positions;

  const n = graphNodes.length;

  // Hierarchical layer assignment based on resource type
  const layerMap: Record<string, number> = {
    VPC: 0, Subnet: 1, SubnetGroup: 1, NATGateway: 1, Route53HostedZone: 1,
    SecurityGroup: 2, WAFWebACL: 2,
    LoadBalancer: 3, TargetGroup: 3, CloudFrontDistribution: 3, APIGatewayRestAPI: 3, APIGatewayHttpAPI: 3,
    EC2Instance: 4, ECSCluster: 4, ECSService: 4, RDSInstance: 4, ElastiCacheCluster: 4, AutoScalingGroup: 4,
    EBSVolume: 5, ElasticIP: 5, EFSFileSystem: 5, KinesisStream: 5,
    LambdaFunction: 6, StepFunction: 6, CodePipeline: 6, CodeBuildProject: 6,
    S3Bucket: 7, DynamoDBTable: 7, SNSTopic: 7, SQSQueue: 7, ECRRepository: 7,
    IAMRole: 8, IAMUser: 8, KMSKey: 8, SecretsManagerSecret: 8, ACMCertificate: 8,
    CloudWatchLogGroup: 9, CloudFormationStack: 9, EventBridgeRule: 9,
    CognitoUserPool: 9, CodeCommitRepo: 9, AmplifyApp: 9,
  };

  // Initialize positions: compact circular arrangement within each layer
  const layerGroups: Record<number, ResourceNode[]> = {};
  for (const node of graphNodes) {
    const layer = layerMap[node.resourceType] ?? 5;
    if (!layerGroups[layer]) layerGroups[layer] = [];
    layerGroups[layer].push(node);
  }

  const layerSpacingY = 180;
  const nodeSpacingX = 220;

  for (const [layerStr, nodes] of Object.entries(layerGroups)) {
    const layer = Number(layerStr);
    const totalWidth = (nodes.length - 1) * nodeSpacingX;
    const startX = -totalWidth / 2;
    for (let i = 0; i < nodes.length; i++) {
      positions[nodes[i].resourceId] = {
        x: startX + i * nodeSpacingX + (Math.random() - 0.5) * 30,
        y: layer * layerSpacingY + (Math.random() - 0.5) * 20,
      };
    }
  }

  // Run force simulation — compact with strong attraction
  const idToIdx: Record<string, number> = {};
  for (let i = 0; i < n; i++) idToIdx[graphNodes[i].resourceId] = i;

  const xs = graphNodes.map(nd => positions[nd.resourceId].x);
  const ys = graphNodes.map(nd => positions[nd.resourceId].y);

  const iterations = 60;
  const repulsionStrength = 50000;
  const attractionStrength = 0.02;
  const damping = 0.85;
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j];
        let dy = ys[i] - ys[j];
        const dist2 = dx * dx + dy * dy + 1;
        const force = repulsionStrength / dist2;
        const dist = Math.sqrt(dist2);
        dx = (dx / dist) * force * temp;
        dy = (dy / dist) * force * temp;
        vx[i] += dx; vy[i] += dy;
        vx[j] -= dx; vy[j] -= dy;
      }
    }

    // Attraction along edges (strong)
    for (const e of graphEdges) {
      const si = idToIdx[e.sourceResourceId];
      const ti = idToIdx[e.targetResourceId];
      if (si === undefined || ti === undefined) continue;
      const dx = xs[ti] - xs[si];
      const dy = ys[ti] - ys[si];
      const fx = dx * attractionStrength * temp;
      const fy = dy * attractionStrength * temp;
      vx[si] += fx; vy[si] += fy;
      vx[ti] -= fx; vy[ti] -= fy;
    }

    // Layer gravity
    for (let i = 0; i < n; i++) {
      const layer = layerMap[graphNodes[i].resourceType] ?? 5;
      const targetY = layer * layerSpacingY;
      vy[i] += (targetY - ys[i]) * 0.05 * temp;
    }

    // Center gravity — pull everything toward origin
    for (let i = 0; i < n; i++) {
      vx[i] += -xs[i] * 0.001 * temp;
      vy[i] += -ys[i] * 0.0005 * temp;
    }

    for (let i = 0; i < n; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      xs[i] += vx[i];
      ys[i] += vy[i];
    }
  }

  for (let i = 0; i < n; i++) {
    positions[graphNodes[i].resourceId] = { x: xs[i], y: ys[i] };
  }

  return positions;
}

// ── Custom node component ──────────────────────────────────────────────

interface CustomNodeData {
  label: string;
  icon: string;
  color: string;
  resourceType: string;
  selected: boolean;
  blastAffected: boolean;
  blastActive: boolean;
  dimmed: boolean;
}

function CustomNodeComponent({ data }: { data: CustomNodeData }) {
  const borderColor = data.selected
    ? "#fff"
    : data.blastAffected
      ? "var(--red)"
      : data.color;

  const opacity = data.dimmed ? 0.25 : 1;
  const glow = data.selected
    ? `0 0 16px ${data.color}, 0 0 32px rgba(255,255,255,0.2)`
    : data.blastAffected
      ? "0 0 12px rgba(239,68,68,0.5)"
      : `0 2px 8px rgba(0,0,0,0.3)`;

  const handleStyle = { background: data.color, width: 6, height: 6, border: "none", opacity: 0 };

  return (
    <div
      className="dep-graph-node"
      style={{
        padding: "10px 16px",
        borderRadius: 12,
        background: data.selected
          ? `linear-gradient(135deg, var(--bg-card) 0%, rgba(${hexToRgb(data.color)},0.08) 100%)`
          : "var(--bg-card)",
        border: `2px solid ${borderColor}`,
        color: "var(--text-primary)",
        fontSize: 12,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity,
        boxShadow: glow,
        minWidth: 110,
        cursor: "pointer",
        position: "relative",
        backdropFilter: "blur(8px)",
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="target" position={Position.Left} id="left" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
      <span style={{ fontSize: 18, filter: data.dimmed ? "grayscale(1)" : "none", transition: "filter 0.3s" }}>{data.icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 600, lineHeight: 1.2, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }} title={data.label}>
          {data.label.length > 24 ? data.label.slice(0, 22) + "…" : data.label}
        </span>
        <span style={{ fontSize: 10, color: data.color, opacity: 0.7, fontWeight: 500 }}>
          {data.resourceType}
        </span>
      </div>
      {data.selected && (
        <div style={{
          position: "absolute", top: -3, right: -3,
          width: 10, height: 10, borderRadius: "50%",
          background: data.color,
          boxShadow: `0 0 8px ${data.color}`,
          animation: "nodePulse 1.5s ease-in-out infinite",
        }} />
      )}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return "139,92,246";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

const nodeTypes = { custom: CustomNodeComponent };

// ── Filter Panel ───────────────────────────────────────────────────────

interface FilterPanelProps {
  resourceTypes: GraphResourceType[];
  selectedTypes: Set<GraphResourceType>;
  onToggleType: (t: GraphResourceType) => void;
  accounts: string[];
  selectedAccount: string;
  onAccountChange: (a: string) => void;
  regions: string[];
  selectedRegion: string;
  onRegionChange: (r: string) => void;
}

function FilterPanel({
  resourceTypes,
  selectedTypes,
  onToggleType,
  accounts,
  selectedAccount,
  onAccountChange,
  regions,
  selectedRegion,
  onRegionChange,
}: FilterPanelProps) {
  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        background: "var(--bg-card)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
        🔍 Filters
      </div>

      {/* Resource Type Checkboxes */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Resource Type
        </div>
        {resourceTypes.map((t) => {
          const style = getResourceTypeStyle(t);
          return (
            <label
              key={t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={selectedTypes.has(t)}
                onChange={() => onToggleType(t)}
                style={{ accentColor: style.color }}
              />
              <span>{style.icon}</span>
              <span>{style.label}</span>
            </label>
          );
        })}
      </div>

      {/* Account Filter */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Account
        </div>
        <select
          value={selectedAccount}
          onChange={(e) => onAccountChange(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: 12,
          }}
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Region Filter */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Region
        </div>
        <select
          value={selectedRegion}
          onChange={(e) => onRegionChange(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: 12,
          }}
        >
          <option value="">All Regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Blast Radius Panel ─────────────────────────────────────────────────

interface BlastRadiusPanelProps {
  selectedNode: ResourceNode | null;
  blastResult: BlastRadiusResult | null;
  recommendation: Recommendation | null;
  onClose: () => void;
}

function BlastRadiusPanel({ selectedNode, blastResult, recommendation, onClose }: BlastRadiusPanelProps) {
  if (!selectedNode || !blastResult) return null;

  const style = getResourceTypeStyle(selectedNode.resourceType);

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: "var(--bg-card)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
          💥 Blast Radius
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 16,
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Selected node info */}
      <div
        style={{
          padding: 10,
          borderRadius: 8,
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${style.color}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>{style.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {selectedNode.displayName}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {selectedNode.resourceType} · {selectedNode.region}
        </div>
      </div>

      {/* Recommendation link */}
      {recommendation && (
        <a
          href={`/recommendations/${recommendation.recommendationId}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.2)",
            color: "var(--accent-light)",
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            transition: "background 0.2s",
          }}
        >
          💡 View Recommendation: {recommendation.issueDescription?.slice(0, 50)}...
        </a>
      )}

      {/* Blast radius summary */}
      {blastResult.totalAffected === 0 ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            color: "var(--green)",
            fontSize: 13,
            fontWeight: 500,
            textAlign: "center",
          }}
        >
          ✅ Safe to remove — no downstream dependencies
        </div>
      ) : (
        <>
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--red)" }}>
              {blastResult.totalAffected}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              affected resource{blastResult.totalAffected !== 1 ? "s" : ""}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
              By Type
            </div>
            {Object.entries(blastResult.affectedByType).map(([type, count]) => {
              const ts = getResourceTypeStyle(type as GraphResourceType);
              return (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                >
                  <span>
                    {ts.icon} {ts.label}
                  </span>
                  <span
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      color: "var(--red)",
                      padding: "1px 8px",
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page Component ────────────────────────────────────────────────

export default function DependencyGraphPage() {
  const [graphData, setGraphData] = useState<{
    nodes: ResourceNode[];
    edges: DependencyEdge[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [blastResult, setBlastResult] = useState<BlastRadiusResult | null>(null);

  // Recommendations state
  const [recommendations, setRecommendations] = useState<Map<string, Recommendation>>(new Map());

  // Filter state
  const [selectedTypes, setSelectedTypes] = useState<Set<GraphResourceType>>(new Set());
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");

  // React Flow state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowInstance = useRef<any>(null);

  // Fetch graph data on mount
  useEffect(() => {
    setLoading(true);
    getDependencyGraph()
      .then((data) => {
        setGraphData({ nodes: data.nodes, edges: data.edges });
        // Initialize filter with all types selected
        const types = new Set(data.nodes.map((n) => n.resourceType));
        setSelectedTypes(types as Set<GraphResourceType>);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch recommendations on mount
  useEffect(() => {
    getRecommendations().then((recs) => {
      const map = new Map<string, Recommendation>();
      for (const rec of recs) {
        map.set(rec.resourceId, rec);
      }
      setRecommendations(map);
    }).catch(() => {});
  }, []);

  // Derive unique resource types, accounts, regions from graph data
  const allResourceTypes = useMemo<GraphResourceType[]>(() => {
    if (!graphData) return [];
    const types = new Set(graphData.nodes.map((n) => n.resourceType));
    return Array.from(types).sort() as GraphResourceType[];
  }, [graphData]);

  const allAccounts = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.accountId))).sort();
  }, [graphData]);

  const allRegions = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((n) => n.region))).sort();
  }, [graphData]);

  // Filter nodes
  const filteredNodes = useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes.filter((n) => {
      if (selectedTypes.size > 0 && !selectedTypes.has(n.resourceType)) return false;
      if (selectedAccount && n.accountId !== selectedAccount) return false;
      if (selectedRegion && n.region !== selectedRegion) return false;
      return true;
    });
  }, [graphData, selectedTypes, selectedAccount, selectedRegion]);

  // Filter edges (both endpoints must be in filtered nodes)
  const filteredEdges = useMemo(() => {
    if (!graphData) return [];
    const nodeIds = new Set(filteredNodes.map((n) => n.resourceId));
    return graphData.edges.filter(
      (e) => nodeIds.has(e.sourceResourceId) && nodeIds.has(e.targetResourceId),
    );
  }, [graphData, filteredNodes]);

  // Compute connected node/edge IDs for highlight
  const connectedIds = useMemo(() => {
    if (!selectedNodeId || !graphData) return { nodes: new Set<string>(), edges: new Set<string>() };
    const nodeSet = new Set<string>([selectedNodeId]);
    const edgeSet = new Set<string>();
    for (const e of graphData.edges) {
      if (e.sourceResourceId === selectedNodeId) {
        nodeSet.add(e.targetResourceId);
        edgeSet.add(`${e.sourceResourceId}-${e.targetResourceId}`);
      }
      if (e.targetResourceId === selectedNodeId) {
        nodeSet.add(e.sourceResourceId);
        edgeSet.add(`${e.sourceResourceId}-${e.targetResourceId}`);
      }
    }
    return { nodes: nodeSet, edges: edgeSet };
  }, [selectedNodeId, graphData]);

  // Blast radius affected IDs
  const blastAffectedIds = useMemo(() => {
    if (!blastResult) return new Set<string>();
    return new Set(blastResult.affectedNodes.map((n) => n.resourceId));
  }, [blastResult]);

  // Build React Flow nodes and edges when filtered data or selection changes
  useEffect(() => {
    if (filteredNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    const positions = forceDirectedLayout(filteredNodes, filteredEdges);
    const blastActive = blastResult !== null && blastResult.totalAffected > 0;

    const newNodes: Node<CustomNodeData>[] = filteredNodes.map((n) => {
      const style = getResourceTypeStyle(n.resourceType);
      const isSelected = n.resourceId === selectedNodeId;
      const isBlastAffected = blastAffectedIds.has(n.resourceId);
      const isConnected = connectedIds.nodes.has(n.resourceId);
      const dimmed = selectedNodeId
        ? !isSelected && !isConnected && !isBlastAffected
        : false;

      return {
        id: n.resourceId,
        type: "custom",
        position: positions[n.resourceId] || { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: n.displayName,
          icon: style.icon,
          color: style.color,
          resourceType: style.label,
          selected: isSelected,
          blastAffected: blastActive && isBlastAffected,
          blastActive,
          dimmed: blastActive ? !isSelected && !isBlastAffected : dimmed,
        },
      };
    });

    const newEdges: Edge[] = filteredEdges.map((e) => {
      const edgeId = `${e.sourceResourceId}-${e.targetResourceId}`;
      const isHighlighted = connectedIds.edges.has(edgeId);
      const isBlastEdge =
        blastActive &&
        (blastAffectedIds.has(e.sourceResourceId) || e.sourceResourceId === selectedNodeId) &&
        (blastAffectedIds.has(e.targetResourceId) || e.targetResourceId === selectedNodeId);

      return {
        id: edgeId,
        source: e.sourceResourceId,
        target: e.targetResourceId,
        type: "default",
        animated: isHighlighted || isBlastEdge,
        label: e.relationshipLabel,
        labelStyle: {
          fontSize: 10,
          fill: "var(--text-muted)",
          opacity: 0,
        },
        labelBgStyle: {
          fill: "var(--bg-card-solid)",
          fillOpacity: 0.9,
        },
        zIndex: 10,
        style: {
          stroke: isBlastEdge
            ? "#ef4444"
            : isHighlighted
              ? "#818cf8"
              : "rgba(139,92,246,0.5)",
          strokeWidth: isHighlighted || isBlastEdge ? 3 : 2,
          opacity: selectedNodeId && !isHighlighted && !isBlastEdge ? 0.1 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: isBlastEdge
            ? "#ef4444"
            : isHighlighted
              ? "#818cf8"
              : "rgba(139,92,246,0.4)",
        },
        className: "react-flow__edge-hover-label",
      };
    });

    setRfNodes(newNodes);
    setRfEdges(newEdges);

    // Trigger fitView after nodes are set so the viewport shows all nodes
    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.3, maxZoom: 0.8 });
    }, 50);
  }, [filteredNodes, filteredEdges, selectedNodeId, blastResult, blastAffectedIds, connectedIds, setRfNodes, setRfEdges]);

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!graphData) return;
      const nodeId = node.id;
      if (selectedNodeId === nodeId) {
        // Deselect
        setSelectedNodeId(null);
        setBlastResult(null);
        return;
      }
      setSelectedNodeId(nodeId);
      const result = calculateBlastRadius(graphData, nodeId);
      setBlastResult(result);
    },
    [graphData, selectedNodeId],
  );

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setBlastResult(null);
  }, []);

  // Toggle resource type filter
  const handleToggleType = useCallback((type: GraphResourceType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Selected node object
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graphData) return null;
    return graphData.nodes.find((n) => n.resourceId === selectedNodeId) ?? null;
  }, [selectedNodeId, graphData]);

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return <LoadingSpinner message="Mapping resource dependencies..." />;
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
          🔗 Dependency Graph
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: 400,
            background: "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid rgba(239,68,68,0.3)",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 14, color: "var(--red)" }}>
            Failed to load dependency graph
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 400, textAlign: "center" }}>
            {error}
          </div>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              getDependencyGraph()
                .then((data) => {
                  setGraphData({ nodes: data.nodes, edges: data.edges });
                  const types = new Set(data.nodes.map((n) => n.resourceType));
                  setSelectedTypes(types as Set<GraphResourceType>);
                })
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
            }}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  const isEmpty = !graphData || graphData.nodes.length === 0;

  return (
    <div style={{ padding: 32, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
          🔗 Dependency Graph
        </div>
        {graphData && graphData.nodes.length > 0 && (
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-light)", display: "inline-block" }} />
              {filteredNodes.length} nodes
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 16, height: 2, background: "rgba(139,92,246,0.5)", display: "inline-block", borderRadius: 1 }} />
              {filteredEdges.length} connections
            </span>
          </div>
        )}
      </div>

      {isEmpty ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 400,
            background: "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🕸️</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              No dependency data yet
            </div>
            <div style={{ fontSize: 13 }}>
              Run a scan to discover resource dependencies
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, height: "calc(100vh - 160px)" }}>
          {/* Left: Filter Panel */}
          <FilterPanel
            resourceTypes={allResourceTypes}
            selectedTypes={selectedTypes}
            onToggleType={handleToggleType}
            accounts={allAccounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            regions={allRegions}
            selectedRegion={selectedRegion}
            onRegionChange={setSelectedRegion}
          />

          {/* Center: React Flow Canvas */}
          <div
            style={{
              flex: 1,
              background: "var(--bg-card)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {filteredNodes.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--text-muted)",
                  fontSize: 14,
                }}
              >
                No resources match the current filters
              </div>
            ) : (
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onInit={(instance) => { reactFlowInstance.current = instance; }}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
                minZoom={0.1}
                maxZoom={2}
                elevateEdgesOnSelect
              >
                <Controls
                  style={{
                    background: "var(--bg-card-solid)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Background color="rgba(139,92,246,0.06)" gap={24} size={1.5} />
                <MiniMap
                  nodeColor={(node) => {
                    const data = node.data as CustomNodeData | undefined;
                    return data?.color ?? "#666";
                  }}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                  maskColor="rgba(0,0,0,0.6)"
                />
              </ReactFlow>
            )}

            {/* Professional graph animations */}
            <style>{`
              /* Node hover effects */
              .dep-graph-node {
                transition: transform 0.2s cubic-bezier(0.4,0,0.2,1),
                            box-shadow 0.2s cubic-bezier(0.4,0,0.2,1),
                            border-color 0.2s ease,
                            opacity 0.3s ease;
              }
              .dep-graph-node:hover {
                transform: translateY(-2px) scale(1.03);
                box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 12px rgba(139,92,246,0.2) !important;
                z-index: 100;
              }

              /* Edge animations */
              .react-flow__edge path {
                stroke-opacity: 1 !important;
                transition: stroke 0.3s ease, stroke-width 0.3s ease, opacity 0.3s ease;
              }
              .react-flow__edge:hover path {
                stroke-width: 3 !important;
                filter: drop-shadow(0 0 4px rgba(139,92,246,0.5));
              }
              .react-flow__edge.animated path {
                stroke-dasharray: 8 4;
                animation: edgeFlow 0.8s linear infinite;
              }

              /* Edge label on hover */
              .react-flow__edge:hover .react-flow__edge-textbg,
              .react-flow__edge:hover .react-flow__edge-text {
                opacity: 1 !important;
              }
              .react-flow__edge-text {
                transition: opacity 0.2s ease;
              }
              .react-flow__edge-textbg {
                transition: opacity 0.2s ease;
              }
              .react-flow__edges {
                z-index: 5 !important;
              }

              /* Animated edge flow */
              @keyframes edgeFlow {
                to { stroke-dashoffset: -12; }
              }

              /* Node pulse indicator */
              @keyframes nodePulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.8); opacity: 0.3; }
              }

              /* Controls styling */
              .react-flow__controls button {
                transition: background 0.2s ease, color 0.2s ease;
              }
              .react-flow__controls button:hover {
                background: rgba(139,92,246,0.15) !important;
              }

              /* MiniMap fade-in */
              .react-flow__minimap {
                animation: fadeSlideUp 0.5s ease-out;
              }

              @keyframes fadeSlideUp {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
              }

              /* Smooth viewport transitions */
              .react-flow__viewport {
                transition: transform 0.15s ease-out;
              }
            `}</style>
          </div>

          {/* Right: Blast Radius Panel */}
          {selectedNode && blastResult && (
            <BlastRadiusPanel
              selectedNode={selectedNode}
              blastResult={blastResult}
              recommendation={selectedNodeId ? recommendations.get(selectedNodeId) ?? null : null}
              onClose={() => {
                setSelectedNodeId(null);
                setBlastResult(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
