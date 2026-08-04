import { configureDropboxApp, disconnectDropbox, getDropboxStatus } from "../../../db/dropbox";
import { ensureMarketSchema } from "../../../db/storage";

export async function GET() {
  try {
    await ensureMarketSchema();
    return Response.json(await getDropboxStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Dropbox settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureMarketSchema();
    const body = await request.json() as { appKey?: string };
    return Response.json(await configureDropboxApp(body.appKey || ""));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save Dropbox settings" }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    await ensureMarketSchema();
    await disconnectDropbox();
    return Response.json(await getDropboxStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to disconnect Dropbox" }, { status: 400 });
  }
}
