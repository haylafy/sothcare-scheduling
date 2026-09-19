-- Zoom / Microsoft Teams as event-type locations. The host's personal meeting
-- link lives in EventType.locationValue; bookings copy it to meetingUrl.
ALTER TYPE "LocationType" ADD VALUE 'ZOOM';
ALTER TYPE "LocationType" ADD VALUE 'MICROSOFT_TEAMS';
