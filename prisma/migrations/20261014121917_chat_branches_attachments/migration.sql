-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "leafId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE INDEX "Attachment_createdAt_idx" ON "Attachment"("createdAt");

-- CreateIndex
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing conversations were linear, so each message replies to the one before it,
-- and the visible branch ends at the newest message. Only the new columns are written.
UPDATE "Message" AS m
SET "parentId" = ordered.previous
FROM (
  SELECT id, LAG(id) OVER (PARTITION BY "conversationId" ORDER BY "createdAt", id) AS previous
  FROM "Message"
) AS ordered
WHERE m.id = ordered.id AND ordered.previous IS NOT NULL;

UPDATE "Conversation" AS c
SET "leafId" = (
  SELECT id FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC, id DESC LIMIT 1
);
