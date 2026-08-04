import { getJobFile, saveJobFile } from "../../../db/storage";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const jobId = String(form.get("jobId") || "");
    const label = String(form.get("label") || "");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file to upload.");
    return Response.json(await saveJobFile(jobId, file, label), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload file" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "File id is required" }, { status: 400 });
    const { metadata, object } = await getJobFile(id);
    const filename = String(metadata.filename).replace(/["\r\n]/g, "");
    return new Response(object.body, {
      headers: {
        "Content-Type": String(metadata.content_type),
        "Content-Length": String(metadata.size_bytes),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download file" }, { status: 404 });
  }
}
