/**
 * Minimal RFC 5545 generator — enough for the invite, update and cancel that a
 * booking produces. Kept in-house so we are not shipping a dependency for
 * ~60 lines of string building.
 */

export interface IcsInput {
  uid: string;
  sequence?: number;
  method: "REQUEST" | "CANCEL";
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizer: { name: string; email: string };
  attendees: Array<{ name?: string; email: string }>;
  url?: string;
  cancelled?: boolean;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape per RFC 5545 §3.3.11. For property VALUES (after the last colon). */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Escape per RFC 5545 §3.2 param-value grammar. For property PARAMETERS
 * (like `CN=` below) -- a different rule from esc() above, which backslash-
 * escapes TEXT values and does nothing for the one character that actually
 * matters in a parameter: an unescaped colon in a name ends the CN
 * parameter early and lets the rest of the string inject new parameters or
 * properties onto that ORGANIZER/ATTENDEE line. `input.organizer.name` and
 * attendee names both come from user-controlled booking form fields (the
 * public booking form only length-caps `name`, it doesn't restrict its
 * characters), so this has to hold even against a deliberately hostile
 * value, not just accidental punctuation.
 *
 * A param-value needs quoting the moment it contains ";", ":", ",", a
 * literal double-quote, or a control character. A quoted param-value has no
 * escape mechanism for an embedded double-quote or newline (RFC 5545 simply
 * does not allow either inside quoted-string), so those are stripped rather
 * than escaped -- losing a stray literal quote mark from an invitee's name
 * is a fully acceptable trade for making injection here impossible outright.
 */
function escParam(value: string): string {
  const cleaned = value.replace(/["\r\n]/g, "");
  return /[;:,]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/** Fold to 75 octets per line, never splitting a multi-byte character. */
function fold(line: string): string {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let limit = 75;

  for (const char of line) {
    // Iterating the string yields whole code points, so a surrogate pair is
    // never cut in half.
    if (Buffer.byteLength(current + char, "utf8") > limit) {
      parts.push(current);
      current = char;
      limit = 74; // continuation lines start with a leading space
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);

  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

export function buildIcs(input: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sothcare//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SUMMARY:${esc(input.summary)}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${escParam(input.organizer.name)}:mailto:${input.organizer.email}`,
    ...input.attendees.map(
      (a) =>
        `ATTENDEE;CN=${escParam(a.name ?? a.email)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${a.email}`,
    ),
  ];

  if (input.description) lines.push(`DESCRIPTION:${esc(input.description)}`);
  if (input.location) lines.push(`LOCATION:${esc(input.location)}`);
  if (input.url) lines.push(`URL:${input.url}`);

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n");
}
