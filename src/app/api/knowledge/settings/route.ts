import { errorResponse, readBody } from "@/lib/api-route";
import { prisma } from "@/lib/db";
import { getEmbeddingModel, DEFAULT_EMBEDDING_MODEL } from "@/lib/knowledge/embed";
import { getMemorySettings, setMemoryEnabled } from "@/lib/knowledge/memory";
import { knowledgeSettingsSchema } from "@/lib/knowledge/schemas";
import { knowledgeStats } from "@/lib/knowledge/service";

async function current() {
  return { embeddingModelId: await getEmbeddingModel(), defaultEmbeddingModelId: DEFAULT_EMBEDDING_MODEL, memoryEnabled: (await getMemorySettings()).enabled, stats: await knowledgeStats() };
}

export async function GET() {
  try {
    return Response.json(await current());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const patch = await readBody(request, knowledgeSettingsSchema);
    if (patch.embeddingModelId !== undefined) {
      await prisma.appSettings.upsert({
        where: { id: 1 },
        update: { embeddingModelId: patch.embeddingModelId },
        create: { id: 1, embeddingModelId: patch.embeddingModelId },
      });
    }
    if (patch.memoryEnabled !== undefined) await setMemoryEnabled(patch.memoryEnabled);
    return Response.json(await current());
  } catch (error) {
    return errorResponse(error);
  }
}
