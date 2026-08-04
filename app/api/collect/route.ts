import { collectDueSources } from "../../../db/storage";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json(await collectDueSources(Boolean(body.force)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run collection" }, { status: 500 });
  }
}
