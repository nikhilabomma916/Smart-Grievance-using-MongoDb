const bcrypt = require("bcryptjs");
const express = require("express");
const User = require("../models/User");
const { clearSessionCookie, destroySession, requireAuth, setSession } = require("../middleware/auth");
const { createRateLimit } = require("../middleware/rateLimit");

const router = express.Router();
const loginLimit = createRateLimit({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  message: "Too many login attempts. Please try again later."
});
const registrationLimit = createRateLimit({
  limit: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many registration attempts. Please try again later."
});
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;
const reservedOfficerEmails = new Set([
  "roads.officer@example.com",
  "water.officer@example.com",
  "drainage.officer@example.com",
  "sanitation.officer@example.com",
  "electricity.officer@example.com",
  "forestry.officer@example.com"
]);

function sendValidationError(res, errors) {
  return res.status(400).json({
    success: false,
    error: "Please correct the highlighted fields.",
    errors
  });
}

function calculateAge(dateOfBirth, today = new Date()) {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const birthdayPassed =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age;
}

function getMinimumAge() {
  const configured = Number.parseInt(process.env.CITIZEN_MIN_AGE || "18", 10);
  return Number.isInteger(configured) && configured >= 13 && configured <= 100 ? configured : 18;
}

router.post("/register", registrationLimit, async (req, res, next) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const errors = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneCountryCode = typeof body.phoneCountryCode === "string" ? body.phoneCountryCode.trim() : "";
  const rawPhoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const phoneNumber = rawPhoneNumber.replace(/\D/g, "").replace(/^0+/, "");
  const country = typeof body.country === "string" ? body.country.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const postalCode = typeof body.postalCode === "string" ? body.postalCode.trim().toUpperCase() : "";
  const gender = typeof body.gender === "string" ? body.gender.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const dateValue = typeof body.dateOfBirth === "string" ? body.dateOfBirth : "";
  const dateOfBirth = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? new Date(`${dateValue}T00:00:00.000Z`) : null;
  const minimumAge = getMinimumAge();

  if (name.length < 2 || name.length > 100) errors.name = "Enter your full name (2–100 characters).";
  if (email.length > 254 || !emailPattern.test(email)) errors.email = "Enter a valid email address.";
  if (
    process.env.ADMIN_EMAIL &&
    email === process.env.ADMIN_EMAIL.trim().toLowerCase()
  ) {
    errors.email = "This email address is reserved for an authorized officer account.";
  }
  if (reservedOfficerEmails.has(email)) {
    errors.email = "This email address is reserved for an authorized officer account.";
  }
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime()) || dateOfBirth.toISOString().slice(0, 10) !== dateValue) {
    errors.dateOfBirth = "Enter a valid date of birth.";
  } else if (dateOfBirth > new Date()) {
    errors.dateOfBirth = "Date of birth cannot be in the future.";
  } else if (calculateAge(dateOfBirth) < minimumAge) {
    errors.dateOfBirth = `You must be at least ${minimumAge} years old to register.`;
  }
  if (!/^\+[1-9]\d{0,2}$/.test(phoneCountryCode)) {
    errors.phoneCountryCode = "Enter a valid international calling code, such as +91.";
  }
  if (!/^\d{6,14}$/.test(phoneNumber) || `${phoneCountryCode.replace(/\D/g, "")}${phoneNumber}`.length > 15) {
    errors.phoneNumber = "Enter a valid phone number with 6–14 national digits.";
  }
  if (!country || country.length > 80) errors.country = "Enter your country.";
  if (!state || state.length > 100) errors.state = "Enter your state or region.";
  if (!city || city.length > 100) errors.city = "Enter your city.";
  if (!postalCode || postalCode.length > 12 || !/^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/.test(postalCode)) {
    errors.postalCode = "Enter a valid PIN or postal code.";
  } else if (country.toLowerCase() === "india" && !/^\d{6}$/.test(postalCode)) {
    errors.postalCode = "An Indian PIN code must contain 6 digits.";
  }
  if (gender && !["Female", "Male", "Non-binary", "Prefer not to say"].includes(gender)) {
    errors.gender = "Select a valid gender option.";
  }
  if (!passwordPattern.test(password)) {
    errors.password = "Use 10–128 characters with an uppercase letter, lowercase letter, number, and symbol.";
  }
  if (typeof body.confirmPassword !== "string" || body.confirmPassword !== password) {
    errors.confirmPassword = "Passwords do not match.";
  }
  if (body.acceptTerms !== true) errors.acceptTerms = "Accept the Terms and Conditions to continue.";

  if (Object.keys(errors).length) return sendValidationError(res, errors);

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      dateOfBirth,
      email,
      phoneCountryCode,
      phoneNumber,
      country,
      state,
      city,
      postalCode,
      ...(gender ? { gender } : {}),
      passwordHash,
      role: "citizen"
    });
    return res.status(201).json({
      success: true,
      message: "Your citizen account has been created. You can now sign in.",
      data: { email: user.email }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "An account with this email address already exists.",
        errors: { email: "This email address is already registered." }
      });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, error: "The registration details are invalid." });
    }
    return next(error);
  }
});

router.post("/login", loginLimit, async (req, res, next) => {
  if (
    !req.body ||
    typeof req.body !== "object" ||
    typeof req.body.email !== "string" ||
    typeof req.body.password !== "string"
  ) {
    return res.status(400).json({ success: false, error: "Email and password are required." });
  }

  const email = req.body.email.trim().toLowerCase();
  if (!emailPattern.test(email) || req.body.password.length > 128) {
    return res.status(400).json({ success: false, error: "Enter a valid email and password." });
  }

  try {
    if (
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_PASSWORD_HASH &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase()
    ) {
      const passwordMatches = await bcrypt.compare(req.body.password, process.env.ADMIN_PASSWORD_HASH);
      if (!passwordMatches) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }
      await setSession(req, {
        email,
        role: "officer",
        name: "System administrator",
        department: "System Administration",
        authorizedDepartments: [
          "Roads Department",
          "Water Department",
          "Drainage Department",
          "Sanitation Department",
          "Electricity Department",
          "Forestry Department",
          "General Grievance Queue",
          "Roads and Public Works",
          "Water Supply",
          "Electricity",
          "Public Safety",
          "General Administration",
          "Unassigned"
        ]
      });
      return res.json({ success: true, data: { email, role: "officer" } });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    if (user) {
      if (!user.isActive) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }
      const passwordMatches = await bcrypt.compare(req.body.password, user.passwordHash);
      if (!passwordMatches) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }
      await setSession(req, {
        email: user.email,
        role: user.role,
        userId: user._id.toString(),
        name: user.name,
        department: user.department,
        specialization: user.specialization
      });
      return res.json({ success: true, data: { email: user.email, role: user.role } });
    }
    return res.status(401).json({ success: false, error: "Invalid email or password." });
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await destroySession(req);
  } catch (error) {
    return next(error);
  }
  clearSessionCookie(res);
  return res.json({ success: true });
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({ success: true, data: req.auth });
});

module.exports = router;
