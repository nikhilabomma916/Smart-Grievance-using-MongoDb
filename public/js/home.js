async function loadPublicStats() {
  const errorMessage = document.getElementById("stats-error");
  try {
    const response = await fetch("/api/dashboard/stats");
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Statistics unavailable.");
    document.querySelectorAll("[data-stat]").forEach((element) => {
      element.textContent = String(result.data[element.dataset.stat] ?? 0);
    });
  } catch {
    errorMessage.classList.remove("d-none");
  }
}

loadPublicStats();
