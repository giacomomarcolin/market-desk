import { syncAllJobFilesToDropbox, syncJobFileToDropbox } from "../../../../db/storage";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { fileId?: string };
    return Response.json(body.fileId ? await syncJobFileToDropbox(body.fileId) : await syncAllJobFilesToDropbox());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Dropbox sync failed" }, { status: 400 });
  }
}
