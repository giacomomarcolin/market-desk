import { getDashboardData } from "../../../db/storage";

export async function GET() {
  try {
    return Response.json(await getDashboardData());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Market Desk" }, { status: 500 });
  }
}
