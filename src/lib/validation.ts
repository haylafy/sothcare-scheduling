import { z } from "zod";

export const slotQuerySchema = z.object({
  host: z.string().min(1),
  event: z.string().min(1),
  /** ISO date, first day of the month being viewed. */
  from: z.string().min(1),
  to: z.string().min(1),
  timezone: z.string().min(1).default("UTC"),
});

export const bookingSchema = z.object({
  host: z.string().min(1),
  event: z.string().min(1),
  start: z.string().datetime(),
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  timezone: z.string().min(1),
  guests: z.array(z.string().email()).max(10).optional(),
  // Bounded so a booking cannot be used to store arbitrary payload.
  answers: z
    .record(z.union([z.string().max(2000), z.array(z.string().max(500)).max(50), z.boolean()]))
    .refine((value) => Object.keys(value).length <= 50, "Too many answers")
    .optional(),
});

export const rescheduleSchema = z.object({
  start: z.string().datetime(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type BookingPayload = z.infer<typeof bookingSchema>;
