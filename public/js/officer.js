const rowContainer = document.getElementById("grievance-rows");
const dashboardMessage = document.getElementById("dashboard-message");
const searchFilter = document.getElementById("search-filter");
const localityFilter = document.getElementById("locality-filter");
const dateFromFilter = document.getElementById("date-from-filter");
const dateToFilter = document.getElementById("date-to-filter");
const statusFilter = document.getElementById("status-filter");
const categoryFilter = document.getElementById("category-filter");
const statuses = ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"];
let grievances = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function showMessage(message, kind = "danger") {
  dashboardMessage.className = `alert alert-${kind}`;
  dashboardMessage.textContent = message;
}

function hideMessage() {
  dashboardMessage.className = "alert d-none";
}

function renderStats(stats) {
  document.querySelectorAll("#admin-stats [data-stat]").forEach((element) => {
    element.textContent = String(stats[element.dataset.stat] ?? 0);
  });
}

function allowedNextStatuses(status) {
  if (status === "Pending") return ["Assigned"];
  if (status === "Assigned") return ["In Progress", "Resolved"];
  if (status === "In Progress") return ["Resolved"];
  return [];
}

function renderRows() {
  const search = searchFilter.value.trim().toLowerCase();
  const locality = localityFilter.value.trim().toLowerCase();
  const status = statusFilter.value;
  const category = categoryFilter.value;
  const from = dateFromFilter.value;
  const through = dateToFilter.value;
  const visible = grievances.filter((item) => {
    const submitted = new Date(item.createdAt);
    const date = Number.isNaN(submitted.getTime()) ? "" : submitted.toISOString().slice(0, 10);
    const address = item.address
      ? [item.address.street, item.address.locality, item.address.city, item.address.state, item.address.postalCode, item.address.landmark].filter(Boolean).join(" ")
      : item.location;
    return (!search || item.complaintId.toLowerCase().includes(search) || item.title.toLowerCase().includes(search)) &&
      (!locality || address.toLowerCase().includes(locality)) &&
      (!status || item.status === status) &&
      (!category || item.category === category) &&
      (!from || date >= from) &&
      (!through || date <= through);
  });
  document.getElementById("record-count").textContent =
    `${visible.length} shown · ${grievances.length} loaded for this department`;
  if (!visible.length) {
    rowContainer.innerHTML = `<tr><td colspan="7" class="text-center py-5">No grievances match these filters.</td></tr>`;
    return;
  }

  rowContainer.innerHTML = visible.map((item) => {
    const statusClass = `status-${item.status.toLowerCase().replace(/\s+/g, "-")}`;
    const nextStatuses = allowedNextStatuses(item.status);
    const statusOptions = nextStatuses.map((nextStatus) =>
      `<option value="${escapeHtml(nextStatus)}">${escapeHtml(nextStatus)}</option>`
    ).join("");
    const address = item.address
      ? [item.address.street, item.address.locality, item.address.city, item.address.state, item.address.postalCode, item.address.landmark].filter(Boolean).join(", ")
      : item.location;
    const imageList = (item.images || []).map((image, index) =>
      `<a href="${escapeHtml(image.url)}" target="_blank" rel="noopener"><img class="grievance-evidence-thumb" src="${escapeHtml(image.url)}" alt="Evidence image ${index + 1} for ${escapeHtml(item.complaintId)}"></a>`
    ).join("");
    const history = (item.history || []).map((entry) =>
      `<li><strong>${escapeHtml(entry.newStatus)}</strong> · ${escapeHtml(formatDate(entry.createdAt))} — ${escapeHtml(entry.updaterName)}${entry.remarks ? `<br><span>${escapeHtml(entry.remarks)}</span>` : ""}</li>`
    ).join("");
    const coordinates = item.coordinates
      ? `<p><strong>Coordinates:</strong> ${escapeHtml(item.coordinates.latitude)}, ${escapeHtml(item.coordinates.longitude)}</p>`
      : "";
    const controls = item.status === "Resolved" || item.status === "Rejected"
      ? `<span class="form-hint">This grievance is closed.</span>`
      : `<label class="visually-hidden" for="status-${escapeHtml(item._id)}">Update grievance status</label><select class="form-select status-choice" id="status-${escapeHtml(item._id)}"><option value="">Choose action…</option>${statusOptions}</select><label class="visually-hidden" for="remarks-${escapeHtml(item._id)}">Officer remarks</label><textarea class="form-control remarks-choice" id="remarks-${escapeHtml(item._id)}" rows="2" maxlength="2000" placeholder="Officer remarks; required to resolve"></textarea><button class="btn btn-primary status-button" type="button">Save update</button>`;
    const acceptControl = item.status === "Pending"
      ? `<button class="btn btn-outline-primary accept-button" type="button">Accept grievance</button>`
      : "";
    return `<tr data-id="${escapeHtml(item._id)}">
      <td><details><summary>${escapeHtml(item.title)}</summary><span class="complaint-subline">${escapeHtml(item.complaintId)}</span><div class="detail-content"><p><strong>Citizen:</strong> ${escapeHtml(item.citizenName)} · ${escapeHtml(item.email)} · ${escapeHtml(item.phone)}</p><p><strong>Description:</strong> ${escapeHtml(item.description)}</p>${item.generatedDescription ? `<p><strong>Suggested description:</strong> ${escapeHtml(item.generatedDescription)}</p>` : ""}<p><strong>Full address:</strong> ${escapeHtml(address)}</p>${coordinates}<p><strong>Submitted:</strong> ${escapeHtml(formatDate(item.createdAt))}</p>${imageList ? `<div class="grievance-evidence">${imageList}</div>` : ""}<strong>Status history</strong><ol>${history || `<li>${escapeHtml(item.status)}</li>`}</ol></div></details><span class="complaint-subline">${escapeHtml(item.complaintId)}</span></td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(formatDate(item.createdAt))}</td>
      <td>${escapeHtml(item.department)}</td>
      <td>${escapeHtml(item.assignedOfficerName || "Unassigned")}</td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(item.status)}</span></td>
      <td><div class="action-controls">${acceptControl}${controls}</div></td>
    </tr>`;
  }).join("");
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Your session has ended. Please sign in again.");
  }
  if (!response.ok || !result.success) throw new Error(result.error || "Request failed.");
  return result.data;
}

async function loadDashboard() {
  hideMessage();
  rowContainer.innerHTML = `<tr><td colspan="7" class="text-center py-5">Loading grievances…</td></tr>`;
  try {
    const [stats, records] = await Promise.all([
      apiRequest("/api/officer/grievances/stats"),
      apiRequest("/api/officer/grievances")
    ]);
    renderStats(stats);
    grievances = records;
    renderRows();
  } catch (error) {
    showMessage(error.message || "Could not load grievances.");
    rowContainer.innerHTML = `<tr><td colspan="7" class="text-center py-5">Records could not be loaded. Please refresh.</td></tr>`;
  }
}

rowContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const row = button.closest("tr");
  const id = row.dataset.id;
  button.disabled = true;
  try {
    if (button.classList.contains("accept-button")) {
      await apiRequest(`/api/officer/grievances/${encodeURIComponent(id)}/accept`, { method: "POST" });
      showMessage("Grievance accepted by your account.", "success");
    } else if (button.classList.contains("status-button")) {
      const status = row.querySelector(".status-choice").value;
      const remarks = row.querySelector(".remarks-choice").value.trim();
      if (!status) throw new Error("Choose a status update.");
      if (status === "Resolved" && !remarks) throw new Error("Add resolution remarks before resolving.");
      if (!window.confirm(`Save the status as ${status}?`)) return;
      await apiRequest(`/api/officer/grievances/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, remarks })
      });
      showMessage("Status and remarks saved.", "success");
    }
    await loadDashboard();
  } catch (error) {
    showMessage(error.message || "Unable to save this update.");
  } finally {
    button.disabled = false;
  }
});

for (const filter of [searchFilter, localityFilter, dateFromFilter, dateToFilter, statusFilter, categoryFilter]) {
  filter.addEventListener("input", renderRows);
  filter.addEventListener("change", renderRows);
}
document.getElementById("refresh-button").addEventListener("click", loadDashboard);
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/login.html");
  }
});

apiRequest("/api/auth/me")
  .then((officer) => {
    if (officer.role !== "officer") {
      window.location.replace("/citizen-dashboard.html");
      return;
    }
    document.getElementById("officer-email").textContent = `${officer.name} · ${officer.email}`;
    document.getElementById("officer-department").textContent = officer.department || "Authorized officer";
    return loadDashboard();
  })
  .catch((error) => showMessage(error.message));
