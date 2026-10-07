// Seeds a demo shop, services, barbers, weekly hours and the owner account. Safe to re-run: skips if a shop exists.
import pg from "pg";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const email = process.env.SEED_ADMIN_EMAIL ?? "owner@example.com";
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || password.length < 10) throw new Error("Set SEED_ADMIN_PASSWORD (10+ chars)");

const salt = crypto.randomBytes(16);
const hash = `scrypt$${salt.toString("base64url")}$${crypto.scryptSync(password, salt, 64).toString("base64url")}`;

const c = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined });
await c.connect();
await c.query("BEGIN");
try {
  if ((await c.query("SELECT 1 FROM shops LIMIT 1")).rowCount) {
    console.log("shop already exists; nothing seeded");
  } else {
    const shop = (await c.query(
      "INSERT INTO shops(name, timezone, address, phone) VALUES ($1,'America/Toronto',$2,$3) RETURNING id",
      ["Downtown Barber Co.", "123 Queen St W, Toronto, ON", "(416) 555-0100"],
    )).rows[0].id;
    await c.query("INSERT INTO users(shop_id, role, email, password_hash) VALUES ($1,'owner',$2,$3)", [shop, email, hash]);
    const services = [
      ["Haircut", "Classic cut and style", 30, 35],
      ["Beard trim", "Shape-up and line-up", 20, 20],
      ["Haircut + beard", "Full service", 50, 50],
      ["Kids cut (12 and under)", "", 20, 25],
    ];
    const svcIds = [];
    for (const [i, [n, d, dur, price]] of services.entries())
      svcIds.push((await c.query(
        "INSERT INTO services(shop_id,name,description,duration_min,price,sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [shop, n, d, dur, price, i],
      )).rows[0].id);
    for (const name of ["Alex", "Sam"]) {
      const b = (await c.query("INSERT INTO barbers(shop_id, display_name) VALUES ($1,$2) RETURNING id", [shop, name])).rows[0].id;
      for (const s of svcIds) await c.query("INSERT INTO barber_services(barber_id, service_id) VALUES ($1,$2)", [b, s]);
      // Tue-Sat 09:00-12:30 and 13:30-18:00 (lunch break is the gap)
      for (let wd = 2; wd <= 6; wd++)
        for (const [s, e] of [[540, 750], [810, 1080]])
          await c.query("INSERT INTO availability_rules(barber_id,weekday,start_minute,end_minute) VALUES ($1,$2,$3,$4)", [b, wd, s, e]);
    }
    console.log(`seeded shop and owner account (${email})`);
  }
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
