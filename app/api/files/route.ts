import { getDropboxFile, getJobFile, saveJobFile } from "../../../db/storage";

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
    const path = new URL(request.url).searchParams.get("path");
    if (!id && !path) return Response.json({ error: "File id or Dropbox path is required" }, { status: 400 });
    let download: { body: ReadableStream<Uint8Array> | null; filename: string; sizeBytes?: number; contentType: string };
    if (path) {
      download = await getDropboxFile(path);
    } else {
      const file = await getJobFile(id!);
      download = "dropbox" in file
        ? file.dropbox
        : { body: file.object.body, filename: String(file.metadata.filename), sizeBytes: Number(file.metadata.size_bytes), contentType: String(file.metadata.content_type) };
    }
    const filename = String(download.filename).replace(/["\r\n]/g, "");
    return new Response(download.body, {
      headers: {
        "Content-Type": String(download.contentType),
        ...(download.sizeBytes ? { "Content-Length": String(download.sizeBytes) } : {}),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download file" }, { status: 404 });
  }
}
