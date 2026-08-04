import { configureOpenAI, disconnectOpenAI, getAIStatus } from "../../../db/ai";
import { ensureMarketSchema } from "../../../db/storage";

export async function GET() {
  try {
    await ensureMarketSchema();
    return Response.json(await getAIStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load AI extraction settings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureMarketSchema();
    const body = await request.json() as { apiKey?: string };
    return Response.json(await configureOpenAI(body.apiKey || ""));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the OpenAI key." }, { status: 400 });
  }
}

export async function DELETE() {
  try {
    await ensureMarketSchema();
    return Response.json(await disconnectOpenAI());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to disconnect AI extraction." }, { status: 400 });
  }
}
