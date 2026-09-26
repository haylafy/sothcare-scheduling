-- Demo follow-ups fire a fixed interval after the HOST MARKS the outcome, not
-- after the meeting ends -- the gap is a grace period in which the host can
-- still change their mind.
--
-- This value is added in a migration of its OWN, ahead of the column and of
-- anything that references it. Postgres forbids USING a new enum value in the
-- same transaction that adds it, and Prisma wraps each migration file in one
-- transaction. The container runs `prisma migrate deploy` at boot, so a
-- migration failure is not a red CI job -- it is a crash-loop on a live site.
ALTER TYPE "WorkflowTrigger" ADD VALUE 'AFTER_ATTENDANCE_MARKED';
