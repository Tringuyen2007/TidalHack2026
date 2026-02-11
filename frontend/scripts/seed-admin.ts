/**
 * Seed script — inserts an admin user into MongoDB.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts
 *
 * Reads from environment variables (or .env.local):
 *   MONGODB_URI      — MongoDB connection string
 *   ADMIN_USERNAME   — desired admin username  (default: "admin")
 *   ADMIN_PASSWORD   — desired admin password  (required)
 */

import "dotenv/config";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

if (!process.env.MONGODB_URI) {
  console.error(" MONGODB_URI is not set. Add it to .env.local or export it.");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error(" ADMIN_PASSWORD is not set. Export it or add it to .env.local.");
  process.exit(1);
}

const MONGODB_URI: string = process.env.MONGODB_URI;
const ADMIN_USERNAME: string = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD: string = process.env.ADMIN_PASSWORD;

async function seed() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(); // uses ili_alignment from the URI

    const existing = await db.collection("users").findOne({ username: ADMIN_USERNAME });
    if (existing) {
      console.log(`User "${ADMIN_USERNAME}" already exists — skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await db.collection("users").insertOne({
      username: ADMIN_USERNAME,
      passwordHash,
      createdAt: new Date(),
    });

    console.log(` Admin user "${ADMIN_USERNAME}" created successfully.`);
  } catch (err) {
    console.error(" Seed failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seed();
