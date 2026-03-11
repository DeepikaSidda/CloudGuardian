import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { Recommendation } from "@governance-engine/shared";

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

export async function generateAIRecommendation(rec: Recommendation): Promise<string> {
  const prompt = `You are an AWS cloud security and cost optimization expert. A governance scan found a risk in this resource. Explain clearly:

1. **Why this is risky** — what's the security/cost/operational concern
2. **What could go wrong** — potential impact if left unaddressed
3. **How to fix it** — specific step-by-step remediation actions (AWS CLI commands or console steps)
4. **Best practice** — what to do going forward to prevent this

Resource: ${rec.resourceId} (${rec.resourceType})
Region: ${rec.region}
Issue Found: ${rec.issueDescription}
Risk Level: ${rec.riskLevel}
Suggested Action: ${rec.suggestedAction}
Explanation: ${rec.explanation}
Dependencies: ${rec.dependencies.length > 0 ? rec.dependencies.map(d => `${d.resourceType}: ${d.resourceId} (${d.relationship})`).join(", ") : "None"}
Estimated Monthly Cost: ${rec.estimatedMonthlySavings != null ? `$${rec.estimatedMonthlySavings}/month` : "N/A"}

Be concise but thorough. Use markdown formatting with headers. Keep it under 300 words.`;

  try {
    const response = await bedrock.send(new ConverseCommand({
      modelId: "amazon.nova-lite-v1:0",
      messages: [
        { role: "user", content: [{ text: prompt }] },
      ],
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.3,
      },
    }));

    const text = response.output?.message?.content?.[0]?.text;
    return text ?? "Unable to generate AI recommendation.";
  } catch (err: any) {
    console.error("Bedrock error:", err);
    return `AI analysis unavailable: ${err.message}. Manual review recommended: ${rec.suggestedAction}`;
  }
}
