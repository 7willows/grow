// export { z } from "npm:zod@3.21.4";
// export * as _ from "npm:lodash@4.17.21";
// import "npm:reflect-metadata@0.2.1";
// export { Hono } from "npm:hono@3.5.0";
// export type { Context } from "npm:hono@3.5.0";
// export * as path from "@std/path@0.219.0";
// import * as uuid from "@std/uuid@0.219.0";
// export { serve } from "@std/http@0.219.0";
// export { existsSync } from "@std/fs@0.219.0";
// import depsResolver from "npm:dependency-resolver@2.0.1";
// export const DependencyResolver = depsResolver;
// export { assertEquals, assertRejects } from "@std/assert@0.219.0";
// export * as log from "@std@0.219.0/log/mod.ts";
// export { afterAll, beforeAll, describe, it } from "@std/testing@0.219.0";
// import _dirname from "https://deno.land/x/dirname@1.1.2/mod.ts";
// export const dirname = _dirname;
//
// import { join } from "@std/path@0.219.0";

export interface IMakeLoc {
  __dirname: string;
  __filename: string;
}

export interface IMeta {
  url: string;
  main: boolean;
}

export function dirname(meta: IMeta): IMakeLoc {
  const iURL = meta.url,
    fileStartRegex = /(^(file:)((\/\/)?))/,
    __dirname = join(iURL, "../")
      .replace(fileStartRegex, "")
      .replace(/(\/$)/, ""),
    __filename = iURL.replace(fileStartRegex, "");

  return { __dirname, __filename };
}

export function generateUUID() {
  return uuid.v1.generate().toString();
}
