-- CreateTable
CREATE TABLE "test_numbers" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "phone_hmac" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_numbers_phone_hmac_key" ON "test_numbers"("phone_hmac");

