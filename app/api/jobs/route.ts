import { createJob, deleteJob, getJobDetails, updateJob } from "../../../db/storage";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Job id is required" }, { status: 400 });
    return Response.json(await getJobDetails(id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load job" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await createJob(await request.json()), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save job" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await updateJob(await request.json());
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update job" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: string };
    await deleteJob(body.id || "");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete job" }, { status: 400 });
  }
}
