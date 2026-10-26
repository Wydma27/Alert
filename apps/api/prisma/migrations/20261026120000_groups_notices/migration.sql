-- CreateEnum
CREATE TYPE "RecipientGroup" AS ENUM ('TEACHERS', 'STUDENTS', 'PARENTS');

-- AlterTable
ALTER TABLE "sms_deliveries" ADD COLUMN     "audience" "RecipientGroup",
ADD COLUMN     "bad_number" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contact_key" TEXT,
ADD COLUMN     "notice_id" INTEGER,
ADD COLUMN     "sender" TEXT,
ALTER COLUMN "alert_id" DROP NOT NULL,
ALTER COLUMN "message_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "phone_enc" TEXT,
ADD COLUMN     "phone_hmac" TEXT;

-- CreateTable
CREATE TABLE "teachers" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "position" TEXT,
    "phone_enc" TEXT NOT NULL,
    "phone_hmac" TEXT NOT NULL,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "sender" TEXT,
    "selection" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "parts" INTEGER NOT NULL,
    "encoding" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teachers_phone_hmac_key" ON "teachers"("phone_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_external_id_key" ON "teachers"("external_id");

-- CreateIndex
CREATE INDEX "teachers_last_name_first_name_idx" ON "teachers"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "notices_idempotency_key_key" ON "notices"("idempotency_key");

-- CreateIndex
CREATE INDEX "notices_created_at_idx" ON "notices"("created_at");

-- CreateIndex
CREATE INDEX "sms_deliveries_notice_id_status_idx" ON "sms_deliveries"("notice_id", "status");

-- CreateIndex
CREATE INDEX "sms_deliveries_contact_key_idx" ON "sms_deliveries"("contact_key");

-- CreateIndex
CREATE INDEX "students_phone_hmac_idx" ON "students"("phone_hmac");

-- AddForeignKey
ALTER TABLE "sms_deliveries" ADD CONSTRAINT "sms_deliveries_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Każdy SMS należy albo do alertu (z falą komunikatów), albo do wiadomości do grup – nigdy do obu.
ALTER TABLE "sms_deliveries" ADD CONSTRAINT "sms_deliveries_owner_check" CHECK (
  ("alert_id" IS NOT NULL AND "message_id" IS NOT NULL AND "notice_id" IS NULL)
  OR ("alert_id" IS NULL AND "message_id" IS NULL AND "notice_id" IS NOT NULL)
);
