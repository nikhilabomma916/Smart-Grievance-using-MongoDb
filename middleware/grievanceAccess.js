function officerGrievanceScope(auth) {
  const departments = [...new Set([
    ...(auth.department ? [auth.department] : []),
    ...(Array.isArray(auth.authorizedDepartments) ? auth.authorizedDepartments : [])
  ])].filter((department) => department !== "System Administration");
  if (!departments.length) return { _id: null };
  return { department: { $in: departments } };
}

function isAuthorizedDepartment(auth, department) {
  return auth.department === department ||
    (Array.isArray(auth.authorizedDepartments) && auth.authorizedDepartments.includes(department));
}

function canAccessGrievance(auth, grievance) {
  if (auth.role === "superadmin") return true;
  if (auth.role === "citizen") {
    return Boolean(auth.userId && grievance.citizenId && grievance.citizenId.toString() === auth.userId);
  }
  return isAuthorizedDepartment(auth, grievance.department);
}

module.exports = { canAccessGrievance, isAuthorizedDepartment, officerGrievanceScope };
