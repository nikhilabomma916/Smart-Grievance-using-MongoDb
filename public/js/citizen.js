const message = document.getElementById("citizen-message");
const rows = document.getElementById("citizen-grievance-rows");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleDateString();
}

async function loadCitizenDashboard() {
  try {
    const response = await fetch("/api/citizen/dashboard");
    const result = await response.json();
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/login.html");
      return;
    }
    if (!response.ok || !result.success) throw new Error(result.error || "Could not load your account.");

    const { citizen, grievances } = result.data;
    document.querySelectorAll("[data-stat]").forEach((element) => {
      element.textContent = String(result.data.stats[element.dataset.stat] ?? 0);
    });
    document.getElementById("welcome-title").textContent = `Welcome, ${citizen.name}`;
    document.getElementById("citizen-name").textContent = citizen.name;
    document.getElementById("citizen-email").textContent = citizen.email;
    document.getElementById("summary-email").textContent = citizen.email;
    document.getElementById("citizen-age").textContent = String(citizen.age);
    document.getElementById("citizen-record-count").textContent =
      `${grievances.length} grievance${grievances.length === 1 ? "" : "s"} submitted while signed in`;

    if (!grievances.length) {
      rows.innerHTML = `<tr><td colspan="6" class="text-center py-5">No grievances have been submitted from this account yet. <a href="/submit-grievance.html">Submit your first grievance</a>.</td></tr>`;
      return;
    }
    rows.innerHTML = grievances.map((item) => {
      const statusClass = `status-${item.status.toLowerCase().replace(/\s+/g, "-")}`;
      const location = item.address
        ? [item.address.street, item.address.locality, item.address.city, item.address.state, item.address.postalCode, item.address.landmark]
          .filter(Boolean).join(", ")
        : item.location;
      const images = (item.images || []).map((image, index) =>
        `<a href="${escapeHtml(image.url)}" target="_blank" rel="noopener"><img class="grievance-evidence-thumb" src="${escapeHtml(image.url)}" alt="Evidence image ${index + 1} for ${escapeHtml(item.complaintId)}"></a>`
      ).join("");
      const history = (item.history || []).map((entry) =>
        `<li><strong>${escapeHtml(entry.newStatus)}</strong> · ${escapeHtml(formatDate(entry.createdAt))} — ${escapeHtml(entry.updaterName)}${entry.remarks ? `<br><span>${escapeHtml(entry.remarks)}</span>` : ""}</li>`
      ).join("");
      const coordinates = item.coordinates
        ? `<p><strong>Coordinates:</strong> ${escapeHtml(item.coordinates.latitude)}, ${escapeHtml(item.coordinates.longitude)}</p>`
        : "";
      return `<tr>
        <td><details><summary><strong>${escapeHtml(item.title)}</strong></summary><span class="complaint-subline">${escapeHtml(item.complaintId)}</span><div class="detail-content"><p><strong>Description:</strong> ${escapeHtml(item.description)}</p>${item.generatedDescription ? `<p><strong>Suggested description:</strong> ${escapeHtml(item.generatedDescription)}</p>` : ""}<p><strong>Location:</strong> ${escapeHtml(location)}</p>${coordinates}<p><strong>Assigned officer:</strong> ${escapeHtml(item.assignedOfficerName || "Awaiting assignment")}</p>${images ? `<div class="grievance-evidence">${images}</div>` : ""}<strong>Status history</strong><ol>${history || `<li>${escapeHtml(item.status)}</li>`}</ol></div></details><span class="complaint-subline">${escapeHtml(item.complaintId)}</span></td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td>${escapeHtml(item.department)}</td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td><a class="btn btn-outline-primary btn-sm" href="/track-grievance.html?complaintId=${encodeURIComponent(item.complaintId)}">View status</a></td>
      </tr>`;
    }).join("");
  } catch (error) {
    message.className = "alert alert-danger";
    message.textContent = error.message || "Unable to load your citizen dashboard.";
    rows.innerHTML = `<tr><td colspan="6" class="text-center py-5">Your grievances could not be loaded.</td></tr>`;
  }
}

document.getElementById("citizen-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.replace("/login.html");
});

loadCitizenDashboard();
