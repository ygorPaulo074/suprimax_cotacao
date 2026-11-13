import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node scripts/seed.cjs",
  },
  datasource: {
    // Migrations precisam de conexão direta ou Session pooler; o proxy usa outra URL.
    url: env("DIRECT_URL"),
  },
});
