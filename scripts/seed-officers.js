require("dotenv").config();

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const officers = require("../config/demoOfficers");

async function seedOfficers() {
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI in .env before seeding officers.");
  await mongoose.connect(process.env.MONGODB_URI);
  let created = 0;
  let unchanged = 0;
  for (const officer of officers) {
    const email = officer.email.toLowerCase();
    const existing = await User.findOne({ email }).select("_id");
    if (existing) {
      unchanged += 1;
      continue;
    }
    const passwordHash = await bcrypt.hash(officer.password, 12);
    await User.create({
      name: officer.name,
      email,
      passwordHash,
      role: "officer",
      department: officer.department,
      specialization: officer.specialization,
      isActive: true
    });
    created += 1;
  }
  console.log(`Officer seed complete: ${created} created, ${unchanged} already existed.`);
}

seedOfficers()
  .catch((error) => {
    console.error("[seed-officers] Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
