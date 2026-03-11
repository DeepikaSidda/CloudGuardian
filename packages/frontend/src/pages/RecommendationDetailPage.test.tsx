/**
 * @jest-environment jsdom
 */
import React from "react";

// Mock react-router-dom before importing the component
const mockUseParams = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock("react-router-dom", () => ({
  useParams: () => mockUseParams(),
  useSearchParams: () => [mockSearchParams],
  Link: ({ to, children, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
}));

// Mock api-client
const mockGetRecommendation = jest.fn();
const mockInitiateAction = jest.fn();
const mockGetDependencySubgraph = jest.fn();
jest.mock("../api-client", () => ({
  getRecommendation: (...args: any[]) => mockGetRecommendation(...args),
  initiateAction: (...args: any[]) => mockInitiateAction(...args),
  getAIRecommendation: jest.fn().mockResolvedValue({ aiRecommendation: "test" }),
  getDependencySubgraph: (...args: any[]) => mockGetDependencySubgraph(...args),
}));

// Mock MiniDependencyGraph to avoid ReactFlow rendering in tests
jest.mock("../components/MiniDependencyGraph", () => {
  return function MockMiniDependencyGraph({ resourceId }: { resourceId: string }) {
    return <div data-testid="mini-dependency-graph">{resourceId}</div>;
  };
});

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import RecommendationDetailPage from "./RecommendationDetailPage";
import type { Recommendation, ResourceAction } from "@governance-engine/shared";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    recommendationId: "rec-123",
    scanId: "scan-456",
    accountId: "111222333444",
    region: "us-east-1",
    advisorType: "SafeCleanupAdvisor",
    resourceId: "vol-abc123",
    resourceType: "EBSVolume",
    issueDescription: "Unattached EBS volume",
    suggestedAction: "Delete the volume",
    riskLevel: "Low",
    explanation: "This volume has been unattached for 90 days",
    estimatedMonthlySavings: 10.5,
    dependencies: [],
    availableActions: ["delete"],
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAction(overrides: Partial<ResourceAction> = {}): ResourceAction {
  return {
    actionId: "act-789",
    recommendationId: "rec-123",
    userId: "user-1",
    accountId: "111222333444",
    region: "us-east-1",
    resourceId: "vol-abc123",
    resourceType: "EBSVolume",
    actionType: "delete",
    status: "SUCCESS",
    initiatedAt: "2024-01-02T00:00:00Z",
    result: "Volume deleted successfully",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseParams.mockReturnValue({ id: "rec-123" });
  mockGetDependencySubgraph.mockResolvedValue({ nodes: [], edges: [] });
});

describe("RecommendationDetailPage - Action Initiation", () => {
  it("renders enabled action buttons for available actions", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    mockGetRecommendation.mockResolvedValue(rec);

    await act(async () => { render(<RecommendationDetailPage />); });

    const btn = screen.getByText("delete") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("shows inline confirmation when action button is clicked", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    mockGetRecommendation.mockResolvedValue(rec);

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));

    expect(screen.getByText(/Are you sure you want to/)).toBeTruthy();
    expect(screen.getByText("Confirm delete")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("hides confirmation when Cancel is clicked", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    mockGetRecommendation.mockResolvedValue(rec);

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByText(/Are you sure/)).toBeTruthy();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/Are you sure/)).toBeNull();
  });

  it("calls initiateAction and shows success result", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    const actionResult = makeAction();
    mockGetRecommendation.mockResolvedValue(rec);
    mockInitiateAction.mockResolvedValue(actionResult);

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm delete")); });

    expect(mockInitiateAction).toHaveBeenCalledWith({
      recommendationId: "rec-123",
      actionType: "delete",
      dependencyAcknowledgment: undefined,
    });

    await waitFor(() => {
      expect(screen.getByText("Action executed successfully")).toBeTruthy();
    });
    expect(screen.getByText(/act-789/)).toBeTruthy();
  });

  it("shows error result when action fails", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    mockGetRecommendation.mockResolvedValue(rec);
    mockInitiateAction.mockRejectedValue(new Error("Access denied"));

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm delete")); });

    await waitFor(() => {
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
    expect(screen.getByText("Access denied")).toBeTruthy();
  });

  it("shows dependency warning and requires acknowledgment checkbox", async () => {
    const rec = makeRecommendation({
      availableActions: ["delete"],
      dependencies: [
        { resourceId: "snap-111", resourceType: "Snapshot", relationship: "snapshot references volume" },
      ],
    });
    mockGetRecommendation.mockResolvedValue(rec);

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));

    // Dependency warning is shown
    expect(screen.getByText(/Dependency Warning/)).toBeTruthy();
    expect(screen.getAllByText(/snapshot references volume/).length).toBeGreaterThan(0);

    // Confirm button is disabled before acknowledgment
    const confirmBtn = screen.getByText("Confirm delete") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Check the acknowledgment checkbox
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    // Now confirm button should be enabled
    expect(confirmBtn.disabled).toBe(false);
  });

  it("sends dependencyAcknowledgment when dependencies exist", async () => {
    const rec = makeRecommendation({
      availableActions: ["delete"],
      dependencies: [
        { resourceId: "snap-111", resourceType: "Snapshot", relationship: "snapshot references volume" },
      ],
    });
    const actionResult = makeAction();
    mockGetRecommendation.mockResolvedValue(rec);
    mockInitiateAction.mockResolvedValue(actionResult);

    await act(async () => { render(<RecommendationDetailPage />); });

    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm delete")); });

    expect(mockInitiateAction).toHaveBeenCalledWith({
      recommendationId: "rec-123",
      actionType: "delete",
      dependencyAcknowledgment: true,
    });
  });

  it("refreshes recommendation data after successful action", async () => {
    const rec = makeRecommendation({ availableActions: ["delete"] });
    const actionResult = makeAction();
    mockGetRecommendation.mockResolvedValue(rec);
    mockInitiateAction.mockResolvedValue(actionResult);

    await act(async () => { render(<RecommendationDetailPage />); });

    // Initial load = 1 call
    expect(mockGetRecommendation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("delete"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm delete")); });

    // After successful action, recommendation is refreshed = 2 calls
    await waitFor(() => {
      expect(mockGetRecommendation).toHaveBeenCalledTimes(2);
    });
  });

  it("shows no actions message for resources without available actions", async () => {
    const rec = makeRecommendation({ availableActions: [], resourceType: "IAMUser" });
    mockGetRecommendation.mockResolvedValue(rec);

    await act(async () => { render(<RecommendationDetailPage />); });

    expect(screen.getByText(/No automated actions available/)).toBeTruthy();
  });
});
