import { beginDropboxAuthorization } from "../../../../db/dropbox";
import { ensureMarketSchema } from "../../../../db/storage";

export async function GET(request: Request) {
  try {
    await ensureMarketSchema();
    const callbackUrl = new URL(request.url).searchParams.get("callbackUrl");
    if (!callbackUrl) throw new Error("A Dropbox callback URL is required.");
    return Response.redirect(await beginDropboxAuthorization(callbackUrl), 302);
  } catch (error) {
    const target = new URL("/", request.url);
    target.searchParams.set("dropbox", "error");
    target.searchParams.set("message", error instanceof Error ? error.message : "Dropbox could not be opened.");
    return Response.redirect(target, 302);
  }
}
