import { addJobRequirement, updateRequirement } from "../../../db/storage";

export async function POST(request: Request) {
  try {
    return Response.json(await addJobRequirement(await request.json()), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to add requirement" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await updateRequirement(await request.json());
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update requirement" }, { status: 400 });
  }
}
