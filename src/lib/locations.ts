import type { LocationType } from "@prisma/client";

/** Short label per location, for cards, the public page and emails. */
export const LOCATION_LABELS: Record<LocationType, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  PHONE_HOST_CALLS: "Phone call — we'll call you",
  PHONE_INVITEE_CALLS: "Phone call — you'll call us",
  IN_PERSON: "In person",
  CUSTOM: "Details to follow",
};

/** Options for the event-type editor, in the order they should appear. */
export const LOCATION_OPTIONS: Array<{ value: LocationType; label: string }> = [
  { value: "GOOGLE_MEET", label: "Google Meet (link created automatically)" },
  { value: "ZOOM", label: "Zoom (your personal meeting link)" },
  { value: "MICROSOFT_TEAMS", label: "Microsoft Teams (your meeting link)" },
  { value: "PHONE_HOST_CALLS", label: "Phone — we call the invitee" },
  { value: "PHONE_INVITEE_CALLS", label: "Phone — invitee calls us" },
  { value: "IN_PERSON", label: "In person" },
  { value: "CUSTOM", label: "Custom" },
];

/**
 * Locations where locationValue is a join link that must only be revealed to
 * someone who has actually booked -- never on the public booking page.
 */
export const VIDEO_LINK_LOCATIONS = new Set<LocationType>(["ZOOM", "MICROSOFT_TEAMS"]);
