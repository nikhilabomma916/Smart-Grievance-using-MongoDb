const trackForm = document.getElementById("track-form");
const trackMessage = document.getElementById("track-message");
const trackResult = document.getElementById("track-result");
const trackButton = document.getElementById("track-button");
const complaintInput = document.getElementById("complaintId");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function showTrackError(message) {
  trackMessage.className = "alert alert-danger mt-4";
  trackMessage.textContent = message;
  trackResult.classList.add("d-none");
}

async function findGrievance(complaintId) {
  const normalized = complaintId.trim().toUpperCase();
  if (!normalized) {
    showTrackError("Enter your complaint ID.");
    return;
  }
  trackButton.disabled = true;
  trackButton.textContent = "Searching…";
  trackMessage.className = "alert alert-info mt-4";
  trackMessage.textContent = "Checking the latest database record…";
  trackResult.classList.add("d-none");
  try {
    const response = await fetch(`/api/grievances/track/${encodeURIComponent(normalized)}`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Unable to find this grievance.");
    const item = result.data;
    const statusClass = `status-${item.status.toLowerCase().replace(/\s+/g, "-")}`;
    trackResult.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
        <div><span class="eyebrow">Complaint ${escapeHtml(item.complaintId)}</span><h2>${escapeHtml(item.title)}</h2></div>
        <span class="status-badge ${statusClass}">${escapeHtml(item.status)}</span>
      </div>
      <dl>
        <dt>Category</dt><dd>${escapeHtml(item.category)}</dd>
        <dt>Submitted</dt><dd>${escapeHtml(formatDate(item.createdAt))}</dd>
        <dt>Location</dt><dd>${escapeHtml(item.location)}</dd>
        <dt>Department</dt><dd>${escapeHtml(item.department)}</dd>
        <dt>Last updated</dt><dd>${escapeHtml(formatDate(item.updatedAt))}</dd>
      </dl>`;
    trackMessage.className = "alert d-none mt-4";
    trackResult.classList.remove("d-none");
    const url = new URL(window.location.href);
    url.searchParams.set("complaintId", normalized);
    window.history.replaceState({}, "", url);
  } catch (error) {
    showTrackError(error.message || "Unable to reach the grievance service. Try again.");
  } finally {
    trackButton.disabled = false;
    trackButton.textContent = "Find grievance";
  }
}

trackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  findGrievance(complaintInput.value);
});

const queryId = new URLSearchParams(window.location.search).get("complaintId");
if (queryId) {
  complaintInput.value = queryId;
  findGrievance(queryId);
}
