-- CreateTable
CREATE TABLE "Integration" (
    "provider" TEXT NOT NULL,
    "account" TEXT,
    "encryptedCredentials" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "scopeSet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "OAuthState_createdAt_idx" ON "OAuthState"("createdAt");
