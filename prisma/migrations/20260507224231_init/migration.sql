-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "carName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dateRented" DATE,
    "rentedTill" DATE,
    "rentedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advancePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Car_rentedTill_idx" ON "Car"("rentedTill");

-- CreateIndex
CREATE INDEX "Car_carName_idx" ON "Car"("carName");
