import { FollowupsView } from "@/components/followups-view";
import { getFollowups } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const items = await getFollowups();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Follow-ups</h1>
          <p className="page-subtitle">
            Drafted for partial payments and fees the client agreed to cover.
            Nothing is sent from this app.
          </p>
        </div>
      </div>

      <FollowupsView items={items} />
    </>
  );
}
