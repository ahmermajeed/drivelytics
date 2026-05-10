/*
  Warnings:

  - You are about to drop the `OutlookAuth` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "OutlookAuth";

-- CreateTable
CREATE TABLE "EmailAuth" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAuth_pkey" PRIMARY KEY ("id")
);
