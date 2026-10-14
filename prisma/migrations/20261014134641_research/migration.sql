-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('running', 'complete', 'failed', 'stopped');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "encryptedSearchKey" TEXT,
ADD COLUMN     "searchBaseUrl" TEXT,
ADD COLUMN     "searchKeyLast4" TEXT,
ADD COLUMN     "searchProvider" TEXT;

-- CreateTable
CREATE TABLE "ResearchReport" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "depth" TEXT NOT NULL DEFAULT 'quick',
    "status" "ResearchStatus" NOT NULL DEFAULT 'running',
    "report" TEXT NOT NULL DEFAULT '',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchReport_createdAt_idx" ON "ResearchReport"("createdAt");
