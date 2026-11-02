import { BoardView } from "@/components/board-view";
import { getBoardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  const { rows, summary, reconciled } = await getBoardData();
  return (
    <BoardView
      rows={rows}
      summary={summary}
      reconciled={reconciled}
      autoStart={run === "1"}
    />
  );
}
