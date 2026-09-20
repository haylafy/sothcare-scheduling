-- Per-event-type copy for the "A note from <org>" block in confirmation,
-- reschedule and reminder emails, plus a one-line call-out under it.
ALTER TABLE "EventType" ADD COLUMN "emailNote" TEXT;
ALTER TABLE "EventType" ADD COLUMN "emailHighlight" TEXT;
