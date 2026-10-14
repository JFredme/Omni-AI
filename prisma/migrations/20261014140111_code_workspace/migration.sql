-- CreateTable
CREATE TABLE "CodeProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeProject_updatedAt_idx" ON "CodeProject"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodeFile_projectId_path_key" ON "CodeFile"("projectId", "path");

-- AddForeignKey
ALTER TABLE "CodeFile" ADD CONSTRAINT "CodeFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CodeProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
