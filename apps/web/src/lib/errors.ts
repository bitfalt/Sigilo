import { ConvexError } from "convex/values";

/** Readable error copy: Convex's own messages are generic in production. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  if (error instanceof Error && !/Server Error|\[CONVEX/.test(error.message)) return error.message;
  return fallback;
}
