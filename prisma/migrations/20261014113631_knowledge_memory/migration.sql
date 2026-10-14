-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "embeddingModelId" TEXT,
ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "citations" JSONB;

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'file',
    "sourceId" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "embeddedCount" INTEGER NOT NULL DEFAULT 0,
    "embeddingModel" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "heading" TEXT,
    "page" INTEGER,
    "embedding" BYTEA,
    "embeddingModel" TEXT,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "embedding" BYTEA,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_createdAt_idx" ON "KnowledgeDocument"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_sourceType_sourceId_key" ON "KnowledgeDocument"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentId_index_idx" ON "KnowledgeChunk"("documentId", "index");

-- CreateIndex
CREATE INDEX "Memory_createdAt_idx" ON "Memory"("createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
