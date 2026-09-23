import { finishDropboxAuthorization, getDropboxAuthorizationOrigin } from "../../../../db/dropbox";
import { ensureMarketSchema } from "../../../../db/storage";

export async function GET(request: Request) {
  const callback = new URL(request.url);
  let publicOrigin: string | null = null;
  try {
    await ensureMarketSchema();
    publicOrigin = await getDropboxAuthorizationOrigin(callback.searchParams.get("state"));
    const result = await finishDropboxAuthorization(request.url);
    publicOrigin = result.applicationOrigin;
    const target = new URL("/", publicOrigin);
    target.searchParams.set("dropbox", "connected");
    return Response.redirect(target, 302);
  } catch (error) {
    const target = new URL("/", publicOrigin || callback.origin);
    target.searchParams.set("dropbox", "error");
    target.searchParams.set("message", error instanceof Error ? error.message : "Dropbox could not be connected.");
    return Response.redirect(target, 302);
  }
}
