-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('START', 'UPDATE', 'CANCEL', 'CONFIRM', 'PICKUP');

-- CreateEnum
CREATE TYPE "AlertMode" AS ENUM ('REAL', 'DRILL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertScope" AS ENUM ('SCHOOL', 'CLASSES', 'STUDENTS');

-- CreateEnum
CREATE TYPE "Attendance" AS ENUM ('UNKNOWN', 'PRESENT', 'ABSENT_TODAY', 'MISSING', 'PICKED_UP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallResult" AS ENUM ('REACHED', 'NO_ANSWER', 'WRONG_NUMBER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pin_failed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_locked_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "event_types" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "sms_label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_templates" (
    "kind" "MessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "strip_diacritics" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" SERIAL NOT NULL,
    "mode" "AlertMode" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "event_type_id" INTEGER,
    "event_label" TEXT NOT NULL,
    "event_sms_label" TEXT NOT NULL,
    "pickup_instruction" TEXT NOT NULL,
    "scope" "AlertScope" NOT NULL,
    "send_confirmations" BOOLEAN NOT NULL DEFAULT true,
    "idempotency_key" TEXT NOT NULL,
    "started_by_id" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" INTEGER,
    "closed_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_classes" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "class_id" INTEGER,
    "class_name" TEXT NOT NULL,
    "assembly_point_id" INTEGER,
    "point_name" TEXT NOT NULL,
    "point_address" TEXT NOT NULL,

    CONSTRAINT "alert_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_students" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "alert_class_id" INTEGER NOT NULL,
    "student_id" INTEGER,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "attendance" "Attendance" NOT NULL DEFAULT 'UNKNOWN',
    "attendance_at" TIMESTAMPTZ(3),
    "attendance_by_id" INTEGER,
    "client_updated_at" TIMESTAMPTZ(3),
    "picked_up_by_guardian_id" INTEGER,
    "picked_up_by_name" TEXT,

    CONSTRAINT "alert_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_messages" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "template" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_deliveries" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "message_id" INTEGER NOT NULL,
    "alert_student_id" INTEGER,
    "guardian_id" INTEGER,
    "guardian_name" TEXT,
    "test_number_id" INTEGER,
    "phone_enc" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parts" INTEGER NOT NULL,
    "encoding" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" SERIAL NOT NULL,
    "delivery_id" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DeliveryStatus" NOT NULL,
    "detail" TEXT,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_attempts" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "guardian_id" INTEGER,
    "alert_student_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "result" "CallResult" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alerts_idempotency_key_key" ON "alerts"("idempotency_key");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "alert_classes_alert_id_class_name_key" ON "alert_classes"("alert_id", "class_name");

-- CreateIndex
CREATE INDEX "alert_students_alert_class_id_idx" ON "alert_students"("alert_class_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_students_alert_id_student_id_key" ON "alert_students"("alert_id", "student_id");

-- CreateIndex
CREATE INDEX "alert_messages_alert_id_idx" ON "alert_messages"("alert_id");

-- CreateIndex
CREATE INDEX "sms_deliveries_status_next_attempt_at_idx" ON "sms_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "sms_deliveries_alert_id_status_idx" ON "sms_deliveries"("alert_id", "status");

-- CreateIndex
CREATE INDEX "sms_deliveries_provider_provider_message_id_idx" ON "sms_deliveries"("provider", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_deliveries_message_id_alert_student_id_guardian_id_key" ON "sms_deliveries"("message_id", "alert_student_id", "guardian_id");

-- CreateIndex
CREATE INDEX "delivery_events_delivery_id_idx" ON "delivery_events"("delivery_id");

-- CreateIndex
CREATE INDEX "call_attempts_alert_id_idx" ON "call_attempts"("alert_id");

-- AddForeignKey
ALTER TABLE "alert_classes" ADD CONSTRAINT "alert_classes_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_students" ADD CONSTRAINT "alert_students_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_students" ADD CONSTRAINT "alert_students_alert_class_id_fkey" FOREIGN KEY ("alert_class_id") REFERENCES "alert_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_messages" ADD CONSTRAINT "alert_messages_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_deliveries" ADD CONSTRAINT "sms_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_deliveries" ADD CONSTRAINT "sms_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "alert_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_deliveries" ADD CONSTRAINT "sms_deliveries_alert_student_id_fkey" FOREIGN KEY ("alert_student_id") REFERENCES "alert_students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "sms_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ręczne uzupełnienie: najwyżej jeden aktywny alert naraz (ochrona przed podwójnym startem z dwóch urządzeń).
CREATE UNIQUE INDEX "alerts_single_active" ON "alerts" ((true)) WHERE "status" = 'ACTIVE';
