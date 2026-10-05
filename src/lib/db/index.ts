import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon over HTTP: no connection pool to manage, works the same locally and on serverless hosts.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const db = drizzle(neon(url), { schema });
export { schema };
