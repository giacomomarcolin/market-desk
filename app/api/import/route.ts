import { importJobFromLink } from "../../../db/link-import";
import { createJob } from "../../../db/storage";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string };
    const imported = await importJobFromLink(body.url || "");
    const saved = await createJob(imported, "link_import");
    return Response.json({ ...saved, warning: imported.warning }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read that job link.";
    return Response.json({ error: /unique|constraint/i.test(message) ? "This job link is already saved in Market Desk." : message }, { status: 400 });
  }
}
