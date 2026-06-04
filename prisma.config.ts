import { defineConfig } from "prisma/config";
import { config } from "dotenv";
import { existsSync } from "fs";

const envPath = existsSync(".env.local") ? ".env.local" : ".env";
config({ path: envPath });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set in .env.local or .env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
