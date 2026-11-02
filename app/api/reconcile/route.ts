import { runAgent } from "@/lib/agent/run";
import { generateFollowups } from "@/lib/explain";
import { warmMatchExplanations } from "@/lib/match-detail";
import { requestUserId } from "@/lib/auth";
import { withAccount } from "@/lib/account-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Live reconcile fans out several model calls (follow-up drafts); give it room.
// Hobby caps this at 60s; raise on Pro if needed.
export const maxDuration = 60;

// SSE stream: runs the deterministic pass then the agent pass, emitting each
// tool call as it happens so the Board's activity panel fills live. On the
// final event we regenerate follow-up drafts from the fresh reconciliation.
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  // Resolve the account up front so the agent + follow-up spend (live) is
  // billed to it; AsyncLocalStorage context is held across the stream below.
  const userId = await requestUserId(req);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      const run = async () => {
        for await (const ev of runAgent()) {
          send(ev);
        }
        // Follow-ups depend on the final match/gap state — rebuild them now.
        await generateFollowups();
        // Pre-generate match explanations so dialogs open instantly (best-effort).
        await warmMatchExplanations();
      };

      try {
        await (userId ? withAccount(userId, run) : run());
      } catch (err) {
        send({
          type: "status",
          phase: "complete",
          text: `Error: ${err instanceof Error ? err.message : "reconcile failed"}`,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
