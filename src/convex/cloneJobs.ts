/**
 * Per-identity rate limiting + retention for voice-cloning jobs.
 *
 * A job row exists only inside a one-hour window (it records when a clone was
 * requested or refused) and is deleted when it expires, which is what makes
 * "reference and output deleted after the session" true on the server side as
 * well: nothing about a clone outlives the hour beyond a bare outcome row.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const WINDOW_MS = 60 * 60 * 1000;

export const reserve = internalMutation({
  args: { identity: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Retention: drop anything older than the window.
    const stale = await ctx.db
      .query("cloneJobs")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", windowStart))
      .take(500);
    for (const job of stale) await ctx.db.delete(job._id);

    const recent = await ctx.db
      .query("cloneJobs")
      .withIndex("by_identity_time", (q) =>
        q.eq("identity", args.identity).gte("createdAt", windowStart),
      )
      .collect();

    if (recent.length >= args.limit) {
      return { allowed: false as const, used: recent.length, limit: args.limit };
    }

    const id = await ctx.db.insert("cloneJobs", {
      identity: args.identity,
      createdAt: now,
      expiresAt: now + WINDOW_MS,
      outcome: "pending",
    });
    return { allowed: true as const, id, used: recent.length + 1, limit: args.limit };
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("cloneJobs"),
    outcome: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) return;
    await ctx.db.patch(args.id, {
      outcome: args.outcome,
      ...(args.reason ? { reason: args.reason } : {}),
    });
  },
});

/** Used by tests and debugging: count open jobs for an identity. */
export const countPending = internalMutation({
  args: { identity: v.string() },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("cloneJobs")
      .withIndex("by_identity_time", (q) => q.eq("identity", args.identity))
      .collect();
    return jobs.length;
  },
});
