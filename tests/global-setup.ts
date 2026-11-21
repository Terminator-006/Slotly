import type { TestProject } from "vitest/node";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * Tests need a real MongoDB. By default we start a throwaway in-memory mongod
 * (mongodb-memory-server downloads the binary on first run and caches it).
 *
 * To use a server you already have instead (local mongod, a CI service container, an Atlas
 * test cluster), set MONGODB_TEST_URI. Every test creates its own uniquely named database
 * and drops it afterwards, so a shared server is fine, but never point this at production.
 */
let mongod: MongoMemoryServer | undefined;

export async function setup(project: TestProject) {
  const external = process.env.MONGODB_TEST_URI;
  if (external) {
    project.provide("mongoUri", external);
    return;
  }
  mongod = await MongoMemoryServer.create();
  project.provide("mongoUri", mongod.getUri());
}

export async function teardown() {
  await mongod?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
