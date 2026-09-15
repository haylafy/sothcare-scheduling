-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('UNKNOWN', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WorkflowCondition" AS ENUM ('ANY', 'NO_SHOW_ONLY', 'ATTENDED_ONLY');

-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT');

-- AlterEnum
ALTER TYPE "WorkflowAction" ADD VALUE 'CRM_LOG_NOTE';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "attendanceStatus" "AttendanceStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "condition" "WorkflowCondition" NOT NULL DEFAULT 'ANY';

-- CreateTable
CREATE TABLE "CrmAccount" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "provider" "CrmProvider" NOT NULL DEFAULT 'HUBSPOT',
    "externalAccountId" TEXT,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSyncRecord" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" "CrmProvider" NOT NULL DEFAULT 'HUBSPOT',
    "contactId" TEXT NOT NULL,
    "engagementId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "CrmSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmAccount_hostId_idx" ON "CrmAccount"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAccount_hostId_provider_key" ON "CrmAccount"("hostId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSyncRecord_bookingId_key" ON "CrmSyncRecord"("bookingId");

-- CreateIndex
CREATE INDEX "CrmSyncRecord_hostId_idx" ON "CrmSyncRecord"("hostId");

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSyncRecord" ADD CONSTRAINT "CrmSyncRecord_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSyncRecord" ADD CONSTRAINT "CrmSyncRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
