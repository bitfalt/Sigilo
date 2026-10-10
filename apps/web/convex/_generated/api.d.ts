/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as employees from "../employees.js";
import type * as employers from "../employers.js";
import type * as http from "../http.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_operator from "../lib/operator.js";
import type * as me from "../me.js";
import type * as receipts from "../receipts.js";
import type * as registry from "../registry.js";
import type * as runs from "../runs.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  employees: typeof employees;
  employers: typeof employers;
  http: typeof http;
  "lib/identity": typeof lib_identity;
  "lib/operator": typeof lib_operator;
  me: typeof me;
  receipts: typeof receipts;
  registry: typeof registry;
  runs: typeof runs;
  sessions: typeof sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
