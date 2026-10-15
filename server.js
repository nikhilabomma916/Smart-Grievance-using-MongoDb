require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("node:path");
const { connectDatabase } = require("./config/database");
const Grievance = require("./models/Grievance");
const User = require("./models/User");
const GrievanceHistory = require("./models/GrievanceHistory");
const Department = require("./models/Department");
const AuditLog = require("./models/AuditLog");
const authRoutes = require("./routes/auth");
const citizenRoutes = require("./routes/citizen");
const dashboardRoutes = require("./routes/dashboard");
const grievanceRoutes = require("./routes/grievances");
const officerRoutes = require("./routes/officer");
const adminRoutes = require("./routes/admin");
const { officerGrievanceScope } = require("./middleware/grievanceAccess");
const { requireRole, requireSuperAdmin } = require("./middleware/auth");
const demoOfficers = require("./config/demoOfficers");

const app = express();
const port = Number(process.env.PORT) || 5000;
const publicDirectory = path.join(__dirname, "public");
const sessionDurationMs = 8 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

function configureRoutes() {
  app.get("/submit-grievance.html", requireRole("citizen"), (req, res) =>
    res.sendFile(path.join(publicDirectory, "submit-grievance.html"))
  );
  app.get("/officer-dashboard.html", requireRole("officer"), (req, res) =>
    res.sendFile(path.join(publicDirectory, "officer-dashboard.html"))
  );
  app.get("/admin-dashboard.html", requireSuperAdmin, (req, res) =>
    res.sendFile(path.join(publicDirectory, "admin-dashboard.html"))
  );
  app.get("/citizen-dashboard.html", requireRole("citizen"), (req, res) =>
    res.sendFile(path.join(publicDirectory, "citizen-dashboard.html"))
  );
  app.get("/officer", (req, res) => res.redirect("/officer-dashboard.html"));
  app.get("/officer-login.html", (req, res) => res.redirect("/login.html"));
  app.get("/api/auth/demo-officers", (req, res) => {
    const isLoopbackRequest = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
    if (
      process.env.NODE_ENV === "production" ||
      process.env.ENABLE_DEMO_OFFICER_AUTOFILL !== "true" ||
      !isLoopbackRequest
    ) {
      return res.sendStatus(404);
    }

    const accounts = demoOfficers.map(({ name, email, password, department }) => ({
      role: "officer",
      name,
      email,
      password,
      department
    }));

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD;
    if (adminEmail && demoAdminPassword) {
      accounts.push({
        role: "superadmin",
        name: "System administrator",
        email: adminEmail,
        password: demoAdminPassword,
        department: "Super Admin"
      });
    }

    return res.json({ success: true, data: accounts });
  });
  app.get("/api/auth/registration-config", (req, res) => {
    const configuredAge = Number.parseInt(process.env.CITIZEN_MIN_AGE || "18", 10);
    const minimumAge = Number.isInteger(configuredAge) && configuredAge >= 13 && configuredAge <= 100
      ? configuredAge
      : 18;
    return res.json({ success: true, data: { minimumAge } });
  });

  app.get("/api/health/db", async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        return res.status(503).json({
          success: false,
          database: "disconnected",
          error: "MongoDB is not connected."
        });
      }

      await mongoose.connection.db.command({ ping: 1 });
      return res.json({
        success: true,
        database: "connected",
        name: mongoose.connection.name
      });
    } catch (error) {
      console.error("[health] MongoDB ping failed:", error.message);
      return res.status(503).json({
        success: false,
        database: "unavailable",
        error: "MongoDB health check failed."
      });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/citizen", citizenRoutes);
  app.use("/api/grievances", grievanceRoutes);
  app.use("/api/officer", officerRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/admin", adminRoutes);
  app.get("/api/admin/dashboard/stats", requireRole("officer"), async (req, res, next) => {
    try {
      const grouped = await Grievance.aggregate([
        { $match: officerGrievanceScope(req.auth) },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]);
      const counts = Object.fromEntries(
        ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"].map((status) => [status, 0])
      );
      for (const item of grouped) counts[item._id] = item.count;
      return res.json({
        success: true,
        data: { total: Object.values(counts).reduce((sum, count) => sum + count, 0), ...counts }
      });
    } catch (error) {
      return next(error);
    }
  });
  app.use(express.static(publicDirectory));

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    console.error("[server] Request failed:", error.message);
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
      return res.status(400).json({ success: false, error: "Request body must be valid JSON." });
    }
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Each image must be 5 MB or smaller."
        : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
          ? "Upload no more than three images using the images field."
          : "The image upload could not be processed.";
      return res.status(400).json({ success: false, error: message });
    }
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return res.status(502).json({ success: false, error: "A configured external service timed out." });
    }
    if (error.message.includes("provider returned HTTP")) {
      console.error("[integration] External provider failed:", error.message);
      return res.status(502).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "An unexpected server error occurred." });
  });
}

async function startServer() {
  try {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
      throw new Error("Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and SESSION_SECRET in .env before starting.");
    }
    await connectDatabase();
    await User.init();
    await Grievance.init();
    await GrievanceHistory.init();
    await Department.init();
    await AuditLog.init();

    const store = MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: "sessions",
      ttl: sessionDurationMs / 1000,
      autoRemove: "native"
    });
    store.on("error", (error) => {
      console.error("[session] MongoDB session store error:", error.message);
    });
    app.use(session({
      name: "grievance_session",
      secret: process.env.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: sessionDurationMs
      }
    }));

    configureRoutes();
    console.log(`[database] Connected to ${mongoose.connection.name} at ${mongoose.connection.host}`);
    console.log("[database] User, grievance, department, audit, and session collections are ready");
    app.listen(port, () => {
      console.log(`[server] Listening at http://127.0.0.1:${port}`);
    });
  } catch (error) {
    console.error("[startup] Application startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();
