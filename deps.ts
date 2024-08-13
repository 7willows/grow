export { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
export * as _ from "https://deno.land/x/lodash_es@v0.0.2/mod.ts";
export { match, P } from "https://esm.sh/ts-pattern@4.2.2";
export { Hono } from "jsr:@hono/hono@4.5.5";
export type { Context } from "jsr:@hono/hono@4.5.5";
export * as path from "https://deno.land/std@0.198.0/path/mod.ts";
import * as uuid from "https://deno.land/std@0.198.0/uuid/mod.ts";
export { existsSync } from "https://deno.land/std@0.198.0/fs/mod.ts";
import depsResolver from "npm:dependency-resolver@2.0.1";
export const DependencyResolver = depsResolver;
export {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.198.0/assert/mod.ts";
export * as log from "https://deno.land/std@0.198.0/log/mod.ts";
export {
  afterAll,
  beforeAll,
  describe,
  it,
} from "https://deno.land/std@0.198.0/testing/bdd.ts";
import _dirname from "https://deno.land/x/dirname@1.1.2/mod.ts";
export const dirname = _dirname;

export function generateUUID() {
  return uuid.v1.generate().toString();
}
