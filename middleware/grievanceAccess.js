function officerGrievanceScope(auth) {
  const scope = [];
  if (auth.userId) scope.push({ assignedOfficerId: auth.userId });
  const departments = [...new Set([
    ...(auth.department ? [auth.department] : []),
    ...(Array.isArray(auth.authorizedDepartments) ? auth.authorizedDepartments : [])
  ])].filter((department) => department !== "System Administration");
  if (departments.length) scope.push({ department: { $in: departments } });
  if (scope.length === 0) return { _id: null };
  return scope.length === 1 ? scope[0] : { $or: scope };
}

function isAuthorizedDepartment(auth, department) {
  return auth.department === department ||
    (Array.isArray(auth.authorizedDepartments) && auth.authorizedDepartments.includes(department));
}

function canAccessGrievance(auth, grievance) {
  if (auth.role === "citizen") {
    return Boolean(auth.userId && grievance.citizenId && grievance.citizenId.toString() === auth.userId);
  }
  const isAssignedOfficer =
    auth.userId && grievance.assignedOfficerId && grievance.assignedOfficerId.toString() === auth.userId;
  return Boolean(isAssignedOfficer || isAuthorizedDepartment(auth, grievance.department));
}

module.exports = { canAccessGrievance, isAuthorizedDepartment, officerGrievanceScope };
