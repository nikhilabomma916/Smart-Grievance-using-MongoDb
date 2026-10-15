const mongoose = require("mongoose");
const User = require("../models/User");

function readSession(req) {
  const auth = req.session && req.session.auth;
  if (
    !auth ||
    typeof auth.email !== "string" ||
    !["citizen", "officer", "superadmin"].includes(auth.role)
  ) {
    return null;
  }
  return auth;
}

function attachAuth(req, auth) {
  req.auth = {
    email: auth.email,
    role: auth.role,
    userId: auth.userId || null,
    name: auth.name || auth.email,
    department: auth.department || null,
    specialization: auth.specialization || null,
    authorizedDepartments: Array.isArray(auth.authorizedDepartments) ? auth.authorizedDepartments : []
  };
}

async function refreshUserAuth(auth) {
  if (!["citizen", "officer"].includes(auth.role) || !mongoose.isValidObjectId(auth.userId)) return null;
  const user = await User.findById(auth.userId).select("name email role department specialization isActive");
  if (!user || !user.isActive || user.role !== auth.role) return null;
  return {
    ...auth,
    name: user.name,
    email: user.email,
    department: user.department || null,
    specialization: user.specialization || null
  };
}

async function requireAuth(req, res, next) {
  const auth = readSession(req);
  if (!auth) {
    if (req.path.endsWith(".html")) return res.redirect("/login.html");
    return res.status(401).json({ success: false, error: "Authentication is required." });
  }
  try {
    if (["citizen", "officer"].includes(auth.role)) {
      const currentAuth = await refreshUserAuth(auth);
      if (!currentAuth) return res.status(401).json({ success: false, error: "This account is no longer available." });
      attachAuth(req, currentAuth);
    } else if (
      auth.role === "superadmin" &&
      process.env.ADMIN_EMAIL?.trim().toLowerCase() === auth.email
    ) {
      attachAuth(req, auth);
    } else {
      return res.status(403).json({ success: false, error: "This account is not authorized for this action." });
    }
  } catch (error) {
    return next(error);
  }
  return next();
}

function requireRole(role) {
  return async (req, res, next) => {
    const auth = readSession(req);
    if (!auth) {
      if (req.path.endsWith(".html")) return res.redirect("/login.html");
      return res.status(401).json({ success: false, error: "Authentication is required." });
    }
    if (auth.role !== role) {
      if (req.path.endsWith(".html")) {
        const destination = auth.role === "citizen"
          ? "/citizen-dashboard.html"
          : auth.role === "superadmin"
            ? "/admin-dashboard.html"
            : "/officer-dashboard.html";
        return res.redirect(destination);
      }
      return res.status(403).json({ success: false, error: "This account is not authorized for this action." });
    }
    if (role === "superadmin" && process.env.ADMIN_EMAIL?.trim().toLowerCase() !== auth.email) {
      return res.status(403).json({ success: false, error: "Super Admin access is required." });
    }
    if (["citizen", "officer"].includes(role)) {
      try {
        const currentAuth = await refreshUserAuth(auth);
        if (!currentAuth) return res.status(401).json({ success: false, error: "This account is no longer available." });
        attachAuth(req, currentAuth);
      } catch (error) {
        return next(error);
      }
    } else {
      attachAuth(req, auth);
    }
    return next();
  };
}

function requireSuperAdmin(req, res, next) {
  const auth = readSession(req);
  const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!auth) {
    if (req.path.endsWith(".html")) return res.redirect("/login.html");
    return res.status(401).json({ success: false, error: "Authentication is required." });
  }
  if (
    auth.role !== "superadmin" ||
    !configuredAdminEmail ||
    auth.email !== configuredAdminEmail
  ) {
    if (req.path.endsWith(".html")) {
      const destination = auth.role === "citizen"
        ? "/citizen-dashboard.html"
        : auth.role === "officer"
          ? "/officer-dashboard.html"
          : "/login.html";
      return res.redirect(destination);
    }
    return res.status(403).json({ success: false, error: "Super Admin access is required." });
  }
  attachAuth(req, auth);
  return next();
}

function setSession(req, auth) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.auth = {
        email: auth.email,
        role: auth.role,
        userId: auth.userId || null,
        name: auth.name || auth.email,
        department: auth.department || null,
        specialization: auth.specialization || null,
        authorizedDepartments: Array.isArray(auth.authorizedDepartments) ? auth.authorizedDepartments : []
      };
      return req.session.save((saveError) => {
        if (saveError) return reject(saveError);
        return resolve();
      });
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

function clearSessionCookie(res) {
  res.clearCookie("grievance_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
  });
}

module.exports = {
  clearSessionCookie,
  destroySession,
  readSession,
  requireAuth,
  requireRole,
  requireSuperAdmin,
  setSession
};
