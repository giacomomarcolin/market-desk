import { createSourceMonitor, markSourceReviewed } from "../../../db/storage";

export async function POST(request: Request) {
  try {
    await createSourceMonitor(await request.json());
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to add source" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    await markSourceReviewed(String(body.id || ""));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update source" }, { status: 400 });
  }
}
