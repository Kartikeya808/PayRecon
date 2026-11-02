// Phase 0 acceptance check: call each model through the wrapper and show the
// rows it logged to llm_calls. Run: npm run hello
import { complete, MODELS, totalSpendUsd } from "@/lib/llm";
import { db } from "@/lib/db";
import { llmCalls } from "@/db/schema";
import { desc } from "drizzle-orm";

async function main() {
  console.log(`LLM_MODE = ${process.env.LLM_MODE ?? "stub"}\n`);

  for (const model of [MODELS.spark, MODELS.wonder]) {
    const r = await complete({
      model,
      purpose: "hello",
      messages: [{ role: "user", content: "ping" }],
    });
    console.log(
      `${model}: "${r.content}"  [stub=${r.stubbed} cached=${r.cached} cost=$${r.costUsd.toFixed(6)}]`
    );
  }

  const rows = await db
    .select()
    .from(llmCalls)
    .orderBy(desc(llmCalls.createdAt))
    .limit(5);

  console.log("\nRecent llm_calls rows:");
  for (const row of rows) {
    console.log(
      `  #${row.id}  ${row.model}  ${row.purpose}  in=${row.inputTokens} out=${row.outputTokens}  $${row.costUsd}`
    );
  }

  console.log(`\nTotal spend: $${(await totalSpendUsd()).toFixed(6)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
