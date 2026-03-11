import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";

/**
 * Props for the ScanStateMachine construct.
 * Accepts Lambda function references so the state machine can wire them in.
 */
export interface ScanStateMachineProps {
  startScanFn: lambda.IFunction;
  discoverAccountsFn: lambda.IFunction;
  invokeAdvisorsFn: lambda.IFunction;
  completeScanFn: lambda.IFunction;
  failScanFn: lambda.IFunction;
  emailDigestFn?: lambda.IFunction;
  /** Regions to scan — passed into the state machine as default input */
  defaultRegions?: string[];
}

/**
 * CDK construct that defines the Step Functions state machine for scan orchestration.
 *
 * Flow:
 *   StartScan → DiscoverAccounts → GenerateCombinations (Pass) →
 *   MapOverCombinations (InvokeAdvisors per account+region) →
 *   AggregateResults (Pass) → CompleteScan
 *
 * Top-level error catch → FailScan
 */
export class ScanStateMachine extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: ScanStateMachineProps) {
    super(scope, id);

    // --- FailScan handler (used by the top-level catch) ---
    const failScan = new tasks.LambdaInvoke(this, "FailScan", {
      lambdaFunction: props.failScanFn,
      payload: sfn.TaskInput.fromObject({
        scanId: sfn.JsonPath.stringAt("$.scanId"),
        error: sfn.JsonPath.stringAt("$.error"),
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    // --- Step 1: StartScan — creates scan record, returns config ---
    const startScan = new tasks.LambdaInvoke(this, "StartScan", {
      lambdaFunction: props.startScanFn,
      resultSelector: {
        "scanId.$": "$.Payload.scanId",
        "scanMode.$": "$.Payload.scanMode",
        "regions.$": "$.Payload.regions",
        "lookbackPeriods.$": "$.Payload.lookbackPeriods",
        "crossAccountRoleName.$": "$.Payload.crossAccountRoleName",
      },
      resultPath: "$",
    });

    // --- Step 2: DiscoverAccounts — returns accountIds array ---
    const discoverAccounts = new tasks.LambdaInvoke(this, "DiscoverAccounts", {
      lambdaFunction: props.discoverAccountsFn,
      payload: sfn.TaskInput.fromObject({
        scanMode: sfn.JsonPath.stringAt("$.scanMode"),
      }),
      resultSelector: {
        "accountIds.$": "$.Payload.accountIds",
      },
      resultPath: "$.discovery",
    });

    // --- Step 3: Generate account × region combinations ---
    // Uses a Pass state with intrinsic functions to build the combinations array.
    // Each element: { accountId, region, scanId, lookbackPeriods, crossAccountRoleName }
    const generateCombinations = new sfn.Pass(this, "GenerateCombinations", {
      parameters: {
        "scanId.$": "$.scanId",
        "lookbackPeriods.$": "$.lookbackPeriods",
        "crossAccountRoleName.$": "$.crossAccountRoleName",
        "accountIds.$": "$.discovery.accountIds",
        "regions.$": "$.regions",
      },
    });

    // --- Step 4: Map over accounts, nested map over regions ---
    // Inner map: iterate over regions for a single account
    const invokeAdvisors = new tasks.LambdaInvoke(this, "InvokeAdvisors", {
      lambdaFunction: props.invokeAdvisorsFn,
      payload: sfn.TaskInput.fromObject({
        scanId: sfn.JsonPath.stringAt("$.scanId"),
        accountId: sfn.JsonPath.stringAt("$.accountId"),
        region: sfn.JsonPath.stringAt("$.region"),
        lookbackPeriods: sfn.JsonPath.objectAt("$.lookbackPeriods"),
        crossAccountRoleName: sfn.JsonPath.stringAt("$.crossAccountRoleName"),
      }),
      resultSelector: {
        "resourcesEvaluated.$": "$.Payload.resourcesEvaluated",
        "recommendationCount.$": "$.Payload.recommendationCount",
      },
    });

    const regionMap = new sfn.Map(this, "MapOverRegions", {
      itemsPath: "$.regions",
      itemSelector: {
        "scanId.$": "$.scanId",
        "accountId.$": "$.accountId",
        "region.$": "$$.Map.Item.Value",
        "lookbackPeriods.$": "$.lookbackPeriods",
        "crossAccountRoleName.$": "$.crossAccountRoleName",
      },
      maxConcurrency: 5,
      resultPath: "$.regionResults",
    });
    regionMap.itemProcessor(invokeAdvisors);

    const accountMap = new sfn.Map(this, "MapOverAccounts", {
      itemsPath: "$.accountIds",
      itemSelector: {
        "scanId.$": "$.scanId",
        "accountId.$": "$$.Map.Item.Value",
        "regions.$": "$.regions",
        "lookbackPeriods.$": "$.lookbackPeriods",
        "crossAccountRoleName.$": "$.crossAccountRoleName",
      },
      maxConcurrency: 3,
      resultPath: "$.mapResults",
    });
    accountMap.itemProcessor(regionMap);

    // --- Step 5: Aggregate results ---
    // Flatten the nested map results and sum resourcesEvaluated + recommendationCount.
    // Step Functions doesn't have native reduce, so we use a Pass state to forward
    // the raw results and let the CompleteScan Lambda do the final aggregation.
    const aggregateResults = new sfn.Pass(this, "AggregateResults", {
      parameters: {
        "scanId.$": "$.scanId",
        "mapResults.$": "$.mapResults",
      },
    });

    // --- Step 6: CompleteScan — marks scan as completed ---
    const completeScan = new tasks.LambdaInvoke(this, "CompleteScan", {
      lambdaFunction: props.completeScanFn,
      payload: sfn.TaskInput.fromObject({
        scanId: sfn.JsonPath.stringAt("$.scanId"),
        mapResults: sfn.JsonPath.objectAt("$.mapResults"),
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    // --- Step 7: EmailDigest — send AI-powered email with new findings ---
    const emailDigestStep = props.emailDigestFn
      ? new tasks.LambdaInvoke(this, "EmailDigest", {
          lambdaFunction: props.emailDigestFn,
          payload: sfn.TaskInput.fromObject({
            scanId: sfn.JsonPath.stringAt("$.scanId"),
          }),
          resultPath: sfn.JsonPath.DISCARD,
        }).addCatch(new sfn.Pass(this, "EmailDigestFailed", {
          resultPath: sfn.JsonPath.DISCARD,
        }), { resultPath: sfn.JsonPath.DISCARD })
      : null;

    // --- Chain the happy path ---
    let chain = startScan
      .next(discoverAccounts)
      .next(generateCombinations)
      .next(accountMap)
      .next(aggregateResults)
      .next(completeScan);

    if (emailDigestStep) {
      chain = chain.next(emailDigestStep);
    }

    const definition = chain;

    // --- Top-level error handling ---
    // Catch any error in the chain and route to FailScan.
    // We use addCatch on the startScan step (first in chain) to wrap the whole flow,
    // and also on each subsequent step to ensure errors anywhere are caught.
    const catchProps: sfn.CatchProps = {
      resultPath: "$.errorInfo",
    };

    // Prepare error payload for FailScan
    // Use a Fail state when scanId is unavailable (e.g. StartScan itself failed)
    const failExecution = new sfn.Fail(this, "FailExecution", {
      error: "ScanFailed",
      causePath: "$.errorInfo.Cause",
    });

    const prepareFailPayload = new sfn.Pass(this, "PrepareFailPayload", {
      parameters: {
        "scanId.$": "$.scanId",
        "error.$": "States.Format('Scan failed: {} - {}', $.errorInfo.Error, $.errorInfo.Cause)",
      },
    });
    prepareFailPayload.next(failScan);

    // When StartScan fails, there's no scanId — go straight to Fail
    const prepareStartScanFailPayload = new sfn.Pass(this, "PrepareStartScanFailPayload", {
      parameters: {
        "error.$": "States.Format('StartScan failed: {} - {}', $.errorInfo.Error, $.errorInfo.Cause)",
      },
    });
    prepareStartScanFailPayload.next(failExecution);

    startScan.addCatch(prepareStartScanFailPayload, catchProps);
    discoverAccounts.addCatch(prepareFailPayload, catchProps);
    accountMap.addCatch(prepareFailPayload, catchProps);
    completeScan.addCatch(prepareFailPayload, catchProps);

    // --- Create the state machine ---
    this.stateMachine = new sfn.StateMachine(this, "ScanOrchestrator", {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(1),
      tracingEnabled: true,
    });
  }
}
