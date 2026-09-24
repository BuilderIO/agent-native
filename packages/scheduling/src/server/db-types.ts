/**
 * DB shape contracts.
 *
 * The package doesn't own a live DB connection — it takes `getDb()` from the
 * consumer, which returns a Drizzle client wired to the consumer's schema.
 * This file declares the minimum shape the package needs.
 */
import type * as schemaAll from "../schema/index.js";

export type SchedulingSchema = typeof schemaAll;

/**
 * GetDb accessor — consumer-provided. Typically returns the Drizzle client
 * used everywhere in the template.
 */
export type GetDbFn = () => any;
