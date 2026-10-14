function readSession(req) {
  const auth = req.session && req.session.auth;
  if (
    !auth ||
    typeof auth.email !== "string" ||
    !["citizen", "officer"].includes(auth.role)
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

function requireAuth(req, res, next) {
  const auth = readSession(req);
  if (!auth) {
    if (req.path.endsWith(".html")) return res.redirect("/login.html");
    return res.status(401).json({ success: false, error: "Authentication is required." });
  }
  attachAuth(req, auth);
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    const auth = readSession(req);
    if (!auth) {
      if (req.path.endsWith(".html")) return res.redirect("/login.html");
      return res.status(401).json({ success: false, error: "Authentication is required." });
    }
    if (auth.role !== role) {
      if (req.path.endsWith(".html")) {
        return res.redirect(auth.role === "citizen" ? "/citizen-dashboard.html" : "/officer-dashboard.html");
      }
      return res.status(403).json({ success: false, error: "This account is not authorized for this action." });
    }
    attachAuth(req, auth);
    return next();
  };
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
  setSession
};
