-- When the host marked attendance. Null while attendanceStatus is UNKNOWN.
-- The follow-up run is anchored to this, so re-marking a booking moves the
-- send rather than firing a second one.
ALTER TABLE "Booking" ADD COLUMN "attendanceSetAt" TIMESTAMP(3);
