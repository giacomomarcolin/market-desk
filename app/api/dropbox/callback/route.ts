import { finishDropboxAuthorization } from "../../../../db/dropbox";
import { ensureMarketSchema } from "../../../../db/storage";

export async function GET(request: Request) {
  const target = new URL("/", request.url);
  try {
    await ensureMarketSchema();
    await finishDropboxAuthorization(request.url);
    target.searchParams.set("dropbox", "connected");
  } catch (error) {
    target.searchParams.set("dropbox", "error");
    target.searchParams.set("message", error instanceof Error ? error.message : "Dropbox could not be connected.");
  }
  return Response.redirect(target, 302);
}
