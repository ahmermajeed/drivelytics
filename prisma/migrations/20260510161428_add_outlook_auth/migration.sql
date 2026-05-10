-- CreateTable
CREATE TABLE "OutlookAuth" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutlookAuth_pkey" PRIMARY KEY ("id")
);
