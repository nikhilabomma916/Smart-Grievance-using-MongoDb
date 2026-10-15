const byId = (id) => document.getElementById(id);
const adminMessage = byId("admin-message");
const grievanceRows = byId("grievance-rows");
const grievanceModal = bootstrap.Modal.getOrCreateInstance(byId("grievance-modal"));
const departmentModal = bootstrap.Modal.getOrCreateInstance(byId("department-modal"));
const officerModal = bootstrap.Modal.getOrCreateInstance(byId("officer-modal"));
const state = {
  departments: [],
  categories: [],
  grievances: [],
  grievancePage: 1,
  grievancePages: 1,
  officerPage: 1,
  officerPages: 1,
  auditPage: 1,
  auditPages: 1,
  editingGrievance: null,
  editingDepartment: null,
  editingOfficer: null,
  reports: null
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString();
}

function showMessage(message, kind = "danger") {
  adminMessage.className = `alert alert-${kind} admin-message`;
  adminMessage.textContent = message;
  adminMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideMessage() {
  adminMessage.className = "alert d-none";
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Your session has ended. Please sign in again.");
  }
  if (!response.ok || !result.success) throw new Error(result.error || "The request could not be completed.");
  return result.data;
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== null && value !== undefined) params.set(key, value);
  }
  return params.toString();
}

function overviewFilters() {
  return {
    from: byId("overview-from").value,
    to: byId("overview-to").value,
    department: byId("overview-department").value,
    category: byId("overview-category").value,
    priority: byId("overview-priority").value,
    status: byId("overview-status").value
  };
}

function fillSelect(select, values, placeholder, selectedValue = "") {
  select.replaceChildren(new Option(placeholder, ""));
  for (const value of values) {
    const option = new Option(value, value);
    option.selected = value === selectedValue;
    select.add(option);
  }
}

function renderBars(element, rows, getLabel, getValue, colorClass = "") {
  if (!rows.length) {
    element.innerHTML = `<p class="muted-empty">No matching records.</p>`;
    return;
  }
  const max = Math.max(1, ...rows.map(getValue));
  element.innerHTML = rows.map((row) => {
    const value = Number(getValue(row)) || 0;
    const width = value ? Math.max(2, Math.round(value / max * 100)) : 0;
    return `<div class="chart-row"><span class="chart-label" title="${escapeHtml(getLabel(row))}">${escapeHtml(getLabel(row))}</span><div class="chart-track"><div class="chart-bar ${colorClass}" style="width:${width}%"></div></div><span class="chart-value">${value}</span></div>`;
  }).join("");
}

function renderMonthly(rows) {
  const root = byId("monthly-chart");
  if (!rows.length) {
    root.innerHTML = `<p class="muted-empty">No matching records.</p>`;
    return;
  }
  const max = Math.max(1, ...rows.map((item) => item.total));
  root.innerHTML = rows.map((item) => {
    const height = item.total ? Math.max(3, item.total / max * 115) : 3;
    return `<div class="month-column" title="${escapeHtml(item.label)}: ${item.total} grievances"><span class="month-value">${item.total}</span><div class="month-bar" style="height:${height}px"></div><span class="month-label">${escapeHtml(item.label)}</span></div>`;
  }).join("");
}

function renderOverview(data) {
  for (const card of document.querySelectorAll("#overview-stats [data-stat]")) {
    const key = card.dataset.stat;
    card.textContent = String(data.stats[key] ?? 0);
    if (key === "overdue" || key === "escalated") card.closest(".admin-stat").dataset.warning = String(data.stats[key] > 0);
  }
  renderBars(byId("department-chart"), data.departmentDistribution, (item) => item._id || "Unassigned", (item) => item.total);
  renderBars(byId("status-chart"), data.statusDistribution, (item) => item._id || "Unknown", (item) => item.count);
  renderMonthly(data.monthlyTrends);
  renderBars(byId("performance-chart"), data.departmentPerformance, (item) => `${item._id || "Unassigned"} · ${item.resolutionRate}%`, (item) => item.resolved);
  renderBars(byId("attention-chart"), [
    { label: "Overdue", count: data.stats.overdue },
    { label: "Escalated", count: data.stats.escalated }
  ], (item) => item.label, (item) => item.count);
  if (state.categories.join("|") !== data.categories.map((item) => item._id).join("|")) {
    state.categories = data.categories.map((item) => item._id).filter(Boolean);
    fillSelect(byId("overview-category"), state.categories, "All categories", byId("overview-category").value);
    fillSelect(byId("grievance-category"), state.categories, "All categories", byId("grievance-category").value);
  }
}

function grievancePageParams() {
  const [sort, direction] = byId("grievance-sort").value.split(":");
  return {
    page: state.grievancePage,
    limit: 25,
    search: byId("grievance-search").value.trim(),
    status: byId("grievance-status").value,
    department: byId("grievance-department").value,
    category: byId("grievance-category").value,
    priority: byId("grievance-priority").value,
    from: byId("grievance-from").value,
    to: byId("grievance-to").value,
    sort,
    direction
  };
}

function renderGrievance(item) {
  const isOverdue = item.slaDeadline && new Date(item.slaDeadline) < new Date() && !["Resolved", "Rejected"].includes(item.status);
  const statusClass = `status-${String(item.status).toLowerCase().replace(/\s+/g, "-")}`;
  const priority = item.priority || "Medium";
  const sla = item.slaDeadline
    ? `<span class="${isOverdue ? "sla-overdue" : ""}">${escapeHtml(formatDate(item.slaDeadline))}${isOverdue ? " · overdue" : ""}</span>`
    : `<span class="text-secondary">Not set</span>`;
  return `<tr data-id="${escapeHtml(item._id)}">
    <td><span class="grievance-title">${escapeHtml(item.title)}</span><span class="grievance-subtitle">${escapeHtml(item.complaintId)}</span></td>
    <td class="citizen-cell"><strong>${escapeHtml(item.citizenName)}</strong><span>${escapeHtml(item.email)}</span></td>
    <td><strong>${escapeHtml(item.category)}</strong><span class="d-block text-secondary">${escapeHtml(item.department || "Unassigned")}</span></td>
    <td>${escapeHtml(item.assignedOfficerName || "Unassigned")}</td>
    <td><span class="admin-badge priority-${escapeHtml(priority)}">${escapeHtml(priority)}</span>${item.isEscalated ? `<span class="admin-badge account-inactive ms-1">Escalated</span>` : ""}</td>
    <td>${escapeHtml(formatDate(item.createdAt))}<span class="d-block small">${sla}</span></td>
    <td><span class="status-badge ${escapeHtml(statusClass)}">${escapeHtml(item.status)}</span></td>
    <td class="action-cell"><div class="d-flex flex-wrap gap-1"><button class="btn btn-outline-primary btn-sm open-grievance" data-mode="details" type="button">View</button><button class="btn btn-outline-primary btn-sm open-grievance" data-mode="department" type="button">Dept</button><button class="btn btn-outline-primary btn-sm open-grievance" data-mode="status" type="button">Status</button></div></td>
  </tr>`;
}

async function loadGrievances() {
  const query = queryString(grievancePageParams());
  const result = await apiRequest(`/api/admin/grievances?${query}`);
  state.grievances = result.items;
  state.grievancePages = Math.max(1, result.pages);
  byId("grievance-count").textContent = `${result.total} records`;
  byId("grievance-page").textContent = `Page ${result.page} of ${state.grievancePages}`;
  byId("grievance-prev").disabled = result.page <= 1;
  byId("grievance-next").disabled = result.page >= state.grievancePages;
  grievanceRows.innerHTML = result.items.length
    ? result.items.map(renderGrievance).join("")
    : `<tr><td colspan="8" class="empty-cell">No grievances match these filters.</td></tr>`;
}

function renderDepartments(items) {
  state.departments = items;
  const departmentNames = items.filter((item) => item.isActive).map((item) => item.name);
  for (const id of ["overview-department", "grievance-department", "officer-department-filter"]) {
    const placeholder = id === "overview-department" || id === "grievance-department" ? "All departments" : "All departments";
    fillSelect(byId(id), departmentNames, placeholder, byId(id).value);
  }
  byId("department-rows").innerHTML = items.length ? items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong>${item.description ? `<span class="d-block small text-secondary">${escapeHtml(item.description)}</span>` : ""}</td>
      <td>${item.officerCount}</td><td>${item.total}</td><td>${item.pending}</td><td>${item.inProgress}</td><td>${item.resolved}</td><td>${item.overdue}</td><td>${item.resolutionRate}%</td>
      <td class="action-cell"><button class="btn btn-outline-primary view-department" data-name="${escapeHtml(item.name)}" type="button">View</button> ${item.name === "Unassigned" ? "" : `<button class="btn btn-outline-primary edit-department" data-name="${escapeHtml(item.name)}" type="button">Edit</button> <button class="btn btn-outline-secondary toggle-department" data-name="${escapeHtml(item.name)}" data-active="${item.isActive}" type="button">${item.isActive ? "Deactivate" : "Activate"}</button>`}</td>
    </tr>`).join("") : `<tr><td colspan="9" class="empty-cell">No departments found. Create a department to get started.</td></tr>`;
  updateDepartmentChoices();
}

function updateDepartmentChoices(selectedDepartment = "") {
  const options = state.departments.filter((item) => item.isActive).map((item) => item.name);
  const active = [...options];
  if (selectedDepartment && !active.includes(selectedDepartment)) active.unshift(selectedDepartment);
  fillSelect(byId("officer-department"), active, "Choose a department", selectedDepartment);
  fillSelect(byId("edit-grievance-department"), active, "Choose a department", selectedDepartment);
}

async function loadDepartments() {
  const items = await apiRequest("/api/admin/departments");
  renderDepartments(items);
}

async function loadOfficers() {
  const query = queryString({
    page: state.officerPage,
    limit: 25,
    search: byId("officer-search").value.trim(),
    department: byId("officer-department-filter").value,
    active: byId("officer-active-filter").value
  });
  const result = await apiRequest(`/api/admin/officers?${query}`);
  state.officerPages = Math.max(1, result.pages);
  byId("officer-count").textContent = `${result.total} accounts`;
  byId("officer-page").textContent = `Page ${result.page} of ${state.officerPages}`;
  byId("officer-prev").disabled = result.page <= 1;
  byId("officer-next").disabled = result.page >= state.officerPages;
  byId("officer-rows").innerHTML = result.items.length ? result.items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><span class="d-block small text-secondary">${escapeHtml(item.email)}</span></td>
      <td>${escapeHtml(item.department)}</td><td>${item.workload.assigned}</td><td>${item.workload.pending}</td><td>${item.workload.inProgress}</td><td>${item.workload.resolved}</td><td>${item.workload.overdue}</td>
      <td><span class="admin-badge ${item.isActive ? "status-resolved" : "account-inactive"}">${item.isActive ? "Active" : "Inactive"}</span></td>
      <td class="action-cell"><button class="btn btn-outline-primary edit-officer" data-id="${escapeHtml(item._id)}" type="button">Edit</button></td>
    </tr>`).join("") : `<tr><td colspan="9" class="empty-cell">No officers match these filters.</td></tr>`;
}

function renderReports(data) {
  state.reports = data;
  byId("department-report-rows").innerHTML = data.departments.length ? data.departments.map((item) => `
    <tr><td>${escapeHtml(item._id || "Unassigned")}</td><td>${item.total}</td><td>${item.pending}</td><td>${item.resolved}</td><td>${item.escalated}</td><td>${item.resolutionRate}%</td><td>${item.averageResolutionDays}</td></tr>
  `).join("") : `<tr><td colspan="7" class="empty-cell">No matching department records.</td></tr>`;
  byId("officer-report-rows").innerHTML = data.officers.length ? data.officers.map((item) => `
    <tr><td>${escapeHtml(item.officer?.name || "Officer account unavailable")}<span class="d-block small text-secondary">${escapeHtml(item.officer?.email || "")}</span></td><td>${escapeHtml(item.officer?.department || "")}</td><td>${item.assigned}</td><td>${item.resolved}</td><td>${item.overdue}</td><td>${item.resolutionRate}%</td><td>${item.averageResolutionDays}</td></tr>
  `).join("") : `<tr><td colspan="7" class="empty-cell">No matching officer assignment records.</td></tr>`;
  const trendRows = [
    ...data.monthly.map((item) => ({
      period: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
      total: item.total,
      resolved: item.resolved
    })),
    ...data.yearly.map((item) => ({ period: `${item._id.year} total`, total: item.total, resolved: item.resolved }))
  ];
  byId("trend-report-rows").innerHTML = trendRows.length ? trendRows.map((item) =>
    `<tr><td>${escapeHtml(item.period)}</td><td>${item.total}</td><td>${item.resolved}</td></tr>`
  ).join("") : `<tr><td colspan="3" class="empty-cell">No trend data for this filter.</td></tr>`;
  const overduePanel = byId("overdue-report-panel");
  const escalationPanel = byId("escalation-report-panel");
  byId("overdue-report-rows").innerHTML = data.overdue.length ? data.overdue.map((item) =>
    `<tr><td><strong>${escapeHtml(item.title)}</strong><span class="d-block small text-secondary">${escapeHtml(item.complaintId)}</span><div class="d-flex flex-wrap gap-1 mt-1"><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="details" data-id="${escapeHtml(item._id)}" type="button">View</button><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="department" data-id="${escapeHtml(item._id)}" type="button">Dept</button><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="status" data-id="${escapeHtml(item._id)}" type="button">Status</button></div></td><td>${escapeHtml(item.department)}</td><td>${escapeHtml(item.assignedOfficerName || "Unassigned")}</td><td class="sla-overdue">${escapeHtml(formatDate(item.slaDeadline))}</td><td>${escapeHtml(item.status)}</td></tr>`
  ).join("") : `<tr><td colspan="5" class="empty-cell">No overdue grievances.</td></tr>`;
  byId("escalation-report-rows").innerHTML = data.escalated.length ? data.escalated.map((item) =>
    `<tr><td><strong>${escapeHtml(item.title)}</strong><span class="d-block small text-secondary">${escapeHtml(item.complaintId)}</span><div class="d-flex flex-wrap gap-1 mt-1"><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="details" data-id="${escapeHtml(item._id)}" type="button">View</button><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="department" data-id="${escapeHtml(item._id)}" type="button">Dept</button><button class="btn btn-outline-primary btn-sm report-open-grievance" data-mode="status" data-id="${escapeHtml(item._id)}" type="button">Status</button></div></td><td>${escapeHtml(item.department)}</td><td>${escapeHtml(item.assignedOfficerName || "Unassigned")}</td><td><span class="admin-badge priority-${escapeHtml(item.priority || "Medium")}">${escapeHtml(item.priority || "Medium")}</span></td><td>${escapeHtml(item.status)}</td></tr>`
  ).join("") : `<tr><td colspan="5" class="empty-cell">No escalated grievances.</td></tr>`;
  overduePanel.classList.toggle("d-none", data.overdue.length === 0);
  escalationPanel.classList.toggle("d-none", data.escalated.length === 0);
}

async function loadReports() {
  const query = queryString(overviewFilters());
  renderReports(await apiRequest(`/api/admin/reports?${query}`));
}

async function loadAudit() {
  const result = await apiRequest(`/api/admin/audit-logs?${queryString({ page: state.auditPage, limit: 25 })}`);
  state.auditPages = Math.max(1, result.pages);
  byId("audit-page").textContent = `Page ${result.page} of ${state.auditPages}`;
  byId("audit-prev").disabled = result.page <= 1;
  byId("audit-next").disabled = result.page >= state.auditPages;
  byId("audit-rows").innerHTML = result.items.length ? result.items.map((item) => `
    <tr><td>${escapeHtml(formatDate(item.createdAt))}</td><td><strong>${escapeHtml(item.actorName)}</strong><span class="d-block small text-secondary">${escapeHtml(item.actorEmail)}</span></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.targetType)} · ${escapeHtml(item.targetId)}</td><td><code>${escapeHtml(JSON.stringify(item.details || {}))}</code></td></tr>
  `).join("") : `<tr><td colspan="5" class="empty-cell">No administrative actions have been recorded yet.</td></tr>`;
  byId("audit").classList.toggle("d-none", result.items.length === 0);
}

async function loadOverview() {
  const query = queryString(overviewFilters());
  renderOverview(await apiRequest(`/api/admin/overview?${query}`));
}

async function loadAll() {
  hideMessage();
  try {
    await Promise.all([loadDepartments(), loadOverview(), loadGrievances(), loadOfficers(), loadReports(), loadAudit()]);
  } catch (error) {
    showMessage(error.message || "Some dashboard data could not be loaded.");
  }
}

function statusOptions(status) {
  const transitions = {
    Pending: ["Pending", "Assigned", "In Progress", "Rejected"],
    Assigned: ["Assigned", "In Progress", "Resolved", "Rejected"],
    "In Progress": ["In Progress", "Resolved", "Rejected"],
    Resolved: ["Resolved"],
    Rejected: ["Rejected"]
  };
  return transitions[status] || [status];
}

function renderGrievanceDetails(item) {
  const address = item.address
    ? [item.address.street, item.address.locality, item.address.city, item.address.state, item.address.postalCode, item.address.landmark].filter(Boolean).join(", ")
    : item.location;
  const images = (item.images || []).map((image, index) =>
    `<a href="${escapeHtml(image.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(image.url)}" alt="Evidence image ${index + 1}"></a>`
  ).join("");
  const history = (item.history || []).map((entry) =>
    `<li><strong>${escapeHtml(entry.previousStatus || "Submitted")} → ${escapeHtml(entry.newStatus)}</strong> · ${escapeHtml(formatDate(entry.createdAt))} · ${escapeHtml(entry.updaterName)}${entry.remarks ? `<br>${escapeHtml(entry.remarks)}` : ""}</li>`
  ).join("");
  const assignments = (item.assignmentHistory || []).map((entry) =>
    `<li><strong>${escapeHtml(entry.action)}</strong> · ${escapeHtml(formatDate(entry.createdAt))} · ${escapeHtml(entry.actorName)}<br>${escapeHtml(JSON.stringify(entry.details || {}))}</li>`
  ).join("");
  const notes = (item.adminNotes || []).map((entry) =>
    `<li><strong>${escapeHtml(entry.authorName)}</strong> · ${escapeHtml(formatDate(entry.createdAt))}<br>${escapeHtml(entry.message)}</li>`
  ).join("");
  return `<p><strong>Citizen:</strong> ${escapeHtml(item.citizenName)} · ${escapeHtml(item.email)} · ${escapeHtml(item.phone)}</p>
    <p><strong>Category:</strong> ${escapeHtml(item.category)} · <strong>Submitted:</strong> ${escapeHtml(formatDate(item.createdAt))} · <strong>Last updated:</strong> ${escapeHtml(formatDate(item.updatedAt))}</p>
    <p><strong>Issue:</strong> ${escapeHtml(item.description)}</p>
    ${item.generatedDescription ? `<p><strong>AI suggestion:</strong> ${escapeHtml(item.generatedDescription)}</p>` : ""}
    <p><strong>Location:</strong> ${escapeHtml(address || "Not provided")}${item.coordinates ? ` · ${escapeHtml(item.coordinates.latitude)}, ${escapeHtml(item.coordinates.longitude)}` : ""}</p>
    <p><strong>SLA deadline:</strong> ${escapeHtml(formatDate(item.slaDeadline))}</p>
    ${images ? `<div class="admin-image-list">${images}</div>` : ""}
    <strong>Status history</strong><ol class="admin-history">${history || `<li>No status history recorded.</li>`}</ol>
    <strong>Assignment and administrative history</strong><ol class="admin-history">${assignments || `<li>No assignment changes recorded.</li>`}</ol>
    <strong>Internal notes</strong><ol class="admin-history">${notes || `<li>No administrative notes.</li>`}</ol>`;
}

async function openGrievance(id, mode = "details") {
  try {
    const item = await apiRequest(`/api/admin/grievances/${encodeURIComponent(id)}`);
    state.editingGrievance = item;
    byId("grievance-modal-title").textContent = `Manage ${item.complaintId}`;
    byId("grievance-modal-subtitle").textContent = item.title;
    byId("grievance-detail").innerHTML = renderGrievanceDetails(item);
    updateDepartmentChoices(item.department);
    const officers = await apiRequest(`/api/admin/officers?limit=100&department=${encodeURIComponent(item.department || "")}&active=true`);
    fillSelect(byId("edit-grievance-officer"), officers.items.map((officer) => officer.name), "Unassigned");
    byId("edit-grievance-officer").replaceChildren(new Option("Unassigned", ""));
    for (const officer of officers.items) {
      const option = new Option(`${officer.name} · ${officer.email}`, officer._id);
      option.selected = item.assignedOfficerId === officer._id;
      byId("edit-grievance-officer").add(option);
    }
    byId("edit-grievance-department").value = item.department || "";
    byId("edit-grievance-status").replaceChildren(...statusOptions(item.status).map((status) => new Option(status, status)));
    byId("edit-grievance-status").value = item.status;
    byId("edit-grievance-priority").value = item.priority || "Medium";
    byId("edit-grievance-escalated").value = String(item.isEscalated === true);
    byId("resolution-remarks").value = "";
    byId("admin-note").value = "";
    grievanceModal.show();
    const focusMap = {
      details: byId("grievance-detail"),
      department: byId("edit-grievance-department"),
      officer: byId("edit-grievance-officer"),
      status: byId("edit-grievance-status")
    };
    const target = focusMap[mode] || byId("grievance-detail");
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target.focus({ preventScroll: true });
    target.classList.add("focus-highlight");
    setTimeout(() => target.classList.remove("focus-highlight"), 900);
  } catch (error) {
    showMessage(error.message || "Could not load grievance details.");
  }
}

async function loadDepartmentOfficers(department, selectedOfficerId = "") {
  const query = queryString({ limit: 100, department, active: "true" });
  const result = await apiRequest(`/api/admin/officers?${query}`);
  const select = byId("edit-grievance-officer");
  select.replaceChildren(new Option("Unassigned", ""));
  for (const officer of result.items) {
    const option = new Option(`${officer.name} · ${officer.email}`, officer._id);
    option.selected = officer._id === selectedOfficerId;
    select.add(option);
  }
}

function openDepartment(item = null) {
  state.editingDepartment = item?.name || null;
  byId("department-modal-title").textContent = item ? "Edit department" : "Add department";
  byId("department-name").value = item?.name || "";
  byId("department-description").value = item?.description || "";
  byId("department-active").value = String(item?.isActive ?? true);
  byId("department-name").disabled = Boolean(item && item.name === "Unassigned");
  departmentModal.show();
}

async function openOfficer(id = null) {
  const officer = id ? await apiRequest(`/api/admin/officers/${encodeURIComponent(id)}`) : null;
  if (id && !officer) throw new Error("Officer could not be loaded.");
  state.editingOfficer = officer || null;
  byId("officer-modal-title").textContent = officer ? "Edit officer account" : "Add officer";
  byId("officer-id").value = officer?._id || "";
  byId("officer-name").value = officer?.name || "";
  byId("officer-email-input").value = officer?.email || "";
  byId("officer-email-input").disabled = Boolean(officer);
  byId("officer-specialization").value = officer?.specialization || "";
  byId("officer-password").value = "";
  byId("officer-password").required = !officer;
  byId("password-hint").textContent = officer ? "(leave blank to keep the current password)" : "(required)";
  byId("officer-active").value = String(officer?.isActive ?? true);
  const activeDepartments = state.departments.filter((entry) => entry.isActive).map((entry) => entry.name);
  fillSelect(byId("officer-department"), activeDepartments, "Choose a department", officer?.department || "");
  officerModal.show();
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadReports() {
  if (!state.reports) return showMessage("Reports are not loaded yet.");
  const rows = [
    ["Report", "Department", "Officer", "Total or assigned", "Resolved", "Pending", "Overdue", "Resolution rate", "Average resolution days"],
    ...state.reports.departments.map((item) => [
      "Department", item._id || "Unassigned", "", item.total, item.resolved, item.pending, "", `${item.resolutionRate}%`, item.averageResolutionDays
    ]),
    ...state.reports.officers.map((item) => [
      "Officer", item.officer?.department || "", item.officer?.name || "", item.assigned, item.resolved, "", item.overdue, `${item.resolutionRate}%`, item.averageResolutionDays
    ]),
    ...state.reports.monthly.map((item) => [
      "Monthly trend", `${item._id.year}-${String(item._id.month).padStart(2, "0")}`, "", item.total, item.resolved, "", "", "", ""
    ]),
    ...state.reports.yearly.map((item) => [
      "Yearly trend", item._id.year, "", item.total, item.resolved, "", "", "", ""
    ]),
    ...state.reports.overdue.map((item) => [
      "Overdue grievance", item.department, item.title, "", "", "", formatDate(item.slaDeadline), item.status, item.complaintId
    ]),
    ...state.reports.escalated.map((item) => [
      "Escalated grievance", item.department, item.title, "", "", "", "", item.status, item.complaintId
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "grievance-reports.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

grievanceRows.addEventListener("click", (event) => {
  const button = event.target.closest(".open-grievance");
  const row = button?.closest("tr");
  if (row) openGrievance(row.dataset.id, button.dataset.mode || "details");
});

document.addEventListener("click", (event) => {
  const reportButton = event.target.closest(".report-open-grievance");
  if (reportButton) {
    const id = reportButton.dataset.id;
    if (id) openGrievance(id, reportButton.dataset.mode || "details");
  }

  const quickAction = event.target.closest(".quick-grievance-action");
  if (quickAction && state.editingGrievance) {
    const target = quickAction.dataset.target || "details";
    const focusMap = {
      details: byId("grievance-detail"),
      department: byId("edit-grievance-department"),
      officer: byId("edit-grievance-officer"),
      status: byId("edit-grievance-status")
    };
    const focusTarget = focusMap[target] || byId("grievance-detail");
    focusTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
    focusTarget.focus();
    focusTarget.classList.add("focus-highlight");
    setTimeout(() => focusTarget.classList.remove("focus-highlight"), 950);
  }
});

byId("edit-grievance-department").addEventListener("change", async () => {
  try {
    await loadDepartmentOfficers(byId("edit-grievance-department").value);
  } catch (error) {
    showMessage(error.message || "Could not load department officers.");
  }
});

byId("grievance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.editingGrievance) return;
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  const status = byId("edit-grievance-status").value;
  const resolutionRemarks = byId("resolution-remarks").value.trim();
  if (status === "Resolved" && state.editingGrievance.status !== "Resolved" && !resolutionRemarks) {
    showMessage("Add resolution remarks before marking the grievance resolved.");
    if (submit) submit.disabled = false;
    return;
  }
  try {
    await apiRequest(`/api/admin/grievances/${encodeURIComponent(state.editingGrievance._id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        department: byId("edit-grievance-department").value,
        assignedOfficerId: byId("edit-grievance-officer").value,
        status,
        priority: byId("edit-grievance-priority").value,
        isEscalated: byId("edit-grievance-escalated").value === "true",
        resolutionRemarks,
        note: byId("admin-note").value.trim()
      })
    });
    grievanceModal.hide();
    showMessage("Grievance changes have been saved.", "success");
    await Promise.all([loadAll(), loadGrievances()]);
  } catch (error) {
    showMessage(error.message || "Could not update this grievance.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

byId("department-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const item = state.departments.find((department) => department.name === button.dataset.name);
  if (!item) return;
  if (button.classList.contains("edit-department")) return openDepartment(item);
  if (button.classList.contains("view-department")) {
    byId("grievance-department").value = item.name;
    byId("officer-department-filter").value = item.name;
    state.grievancePage = 1;
    state.officerPage = 1;
    await Promise.all([loadGrievances(), loadOfficers()]);
    byId("grievances").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (button.classList.contains("toggle-department")) {
    try {
      await apiRequest(`/api/admin/departments/by-name/${encodeURIComponent(item.name)}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !item.isActive })
      });
      showMessage(`Department ${item.isActive ? "deactivated" : "activated"}.`, "success");
      await loadAll();
    } catch (error) {
      showMessage(error.message || "Could not update the department.");
    }
  }
});

byId("department-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  const body = {
    name: byId("department-name").value.trim(),
    description: byId("department-description").value.trim(),
    isActive: byId("department-active").value === "true"
  };
  try {
    if (state.editingDepartment) {
      await apiRequest(`/api/admin/departments/by-name/${encodeURIComponent(state.editingDepartment)}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await apiRequest("/api/admin/departments", { method: "POST", body: JSON.stringify(body) });
    }
    departmentModal.hide();
    showMessage("Department details have been saved.", "success");
    await loadAll();
  } catch (error) {
    showMessage(error.message || "Could not save the department.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

byId("officer-rows").addEventListener("click", async (event) => {
  const button = event.target.closest(".edit-officer");
  if (!button) return;
  try {
    await openOfficer(button.dataset.id);
  } catch (error) {
    showMessage(error.message || "Could not load the officer.");
  }
});

byId("officer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  const id = byId("officer-id").value;
  const body = {
    name: byId("officer-name").value.trim(),
    department: byId("officer-department").value,
    specialization: byId("officer-specialization").value.trim(),
    isActive: byId("officer-active").value === "true"
  };
  if (byId("officer-password").value) body.password = byId("officer-password").value;
  if (!id) {
    body.email = byId("officer-email-input").value.trim();
    body.password = byId("officer-password").value;
  }
  try {
    await apiRequest(id ? `/api/admin/officers/${encodeURIComponent(id)}` : "/api/admin/officers", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(body)
    });
    officerModal.hide();
    showMessage("Officer account changes have been saved.", "success");
    await loadAll();
  } catch (error) {
    showMessage(error.message || "Could not save the officer account.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

byId("add-department").addEventListener("click", () => openDepartment());
byId("add-recommended-departments").addEventListener("click", async () => {
  try {
    const result = await apiRequest("/api/admin/departments/recommended", { method: "POST", body: JSON.stringify({}) });
    const detail = result.added.length
      ? `Added ${result.added.join(", ")}. Existing matching departments were reused.`
      : "All recommended departments already exist; no duplicates were created.";
    showMessage(detail, "success");
    await loadAll();
  } catch (error) {
    showMessage(error.message || "Could not add recommended departments.");
  }
});
byId("add-officer").addEventListener("click", () => openOfficer().catch((error) => showMessage(error.message)));
byId("apply-overview-filters").addEventListener("click", () => Promise.all([loadOverview(), loadReports()]).catch((error) => showMessage(error.message)));
byId("refresh-button").addEventListener("click", loadAll);
byId("export-reports").addEventListener("click", downloadReports);

let grievanceSearchTimer;
byId("grievance-search").addEventListener("input", () => {
  clearTimeout(grievanceSearchTimer);
  grievanceSearchTimer = setTimeout(() => { state.grievancePage = 1; loadGrievances().catch((error) => showMessage(error.message)); }, 250);
});
for (const id of ["grievance-status", "grievance-department", "grievance-category", "grievance-priority", "grievance-from", "grievance-to", "grievance-sort"]) {
  byId(id).addEventListener("change", () => { state.grievancePage = 1; loadGrievances().catch((error) => showMessage(error.message)); });
}
byId("grievance-prev").addEventListener("click", () => { state.grievancePage = Math.max(1, state.grievancePage - 1); loadGrievances().catch((error) => showMessage(error.message)); });
byId("grievance-next").addEventListener("click", () => { state.grievancePage = Math.min(state.grievancePages, state.grievancePage + 1); loadGrievances().catch((error) => showMessage(error.message)); });

let officerSearchTimer;
byId("officer-search").addEventListener("input", () => {
  clearTimeout(officerSearchTimer);
  officerSearchTimer = setTimeout(() => { state.officerPage = 1; loadOfficers().catch((error) => showMessage(error.message)); }, 250);
});
for (const id of ["officer-department-filter", "officer-active-filter"]) {
  byId(id).addEventListener("change", () => { state.officerPage = 1; loadOfficers().catch((error) => showMessage(error.message)); });
}
byId("officer-prev").addEventListener("click", () => { state.officerPage = Math.max(1, state.officerPage - 1); loadOfficers().catch((error) => showMessage(error.message)); });
byId("officer-next").addEventListener("click", () => { state.officerPage = Math.min(state.officerPages, state.officerPage + 1); loadOfficers().catch((error) => showMessage(error.message)); });
byId("audit-prev").addEventListener("click", () => { state.auditPage = Math.max(1, state.auditPage - 1); loadAudit().catch((error) => showMessage(error.message)); });
byId("audit-next").addEventListener("click", () => { state.auditPage = Math.min(state.auditPages, state.auditPage + 1); loadAudit().catch((error) => showMessage(error.message)); });
for (const id of ["overdue-report-rows", "escalation-report-rows"]) {
  byId(id).addEventListener("click", (event) => {
    const button = event.target.closest(".report-open-grievance");
    if (button) openGrievance(button.dataset.id);
  });
}
byId("logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/login.html");
  }
});
for (const link of document.querySelectorAll("#adminNav .nav-link")) {
  link.addEventListener("click", () => {
    const collapse = bootstrap.Collapse.getInstance(byId("adminNav"));
    if (collapse) collapse.hide();
  });
}

apiRequest("/api/auth/me")
  .then((user) => {
    if (user.role !== "superadmin") {
      window.location.replace(user.role === "citizen" ? "/citizen-dashboard.html" : "/officer-dashboard.html");
      return;
    }
    byId("admin-name").textContent = user.name || "Super Admin";
    byId("admin-email").textContent = user.email;
    return loadAll();
  })
  .catch((error) => showMessage(error.message || "Could not verify the Super Admin session."));
