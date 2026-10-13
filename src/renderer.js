const licenseView = document.getElementById("licenseView");
const appView = document.getElementById("appView");
const activationForm = document.getElementById("activationForm");
const activationInput = document.getElementById("activationInput");
const activationBtn = document.getElementById("activationBtn");
const activationError = document.getElementById("activationError");
const subscriptionStatus = document.getElementById("subscriptionStatus");
const subscriptionExpiry = document.getElementById("subscriptionExpiry");
const daysRemaining = document.getElementById("daysRemaining");
const machineId = document.getElementById("machineId");
const copyMachineId = document.getElementById("copyMachineId");

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

function showLicense(status, message = "") {
  licenseView.style.display = "block";
  appView.style.display = "none";
  activationError.textContent = message || (status.expired ? "Your subscription has expired. Enter a new activation code." : "");
  activationInput.value = "";
  activationBtn.disabled = false;
}

function showApp(status) {
  licenseView.style.display = "none";
  appView.style.display = "block";
  subscriptionStatus.textContent = "ACTIVE";
  subscriptionExpiry.textContent = formatDate(status.expiresAt);
  daysRemaining.textContent = `${status.daysRemaining} day${status.daysRemaining === 1 ? "" : "s"} remaining`;
  log.textContent = "Subscription active. Ready.";
}

activationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  activationError.textContent = "";
  activationBtn.disabled = true;
  const result = await window.cowayApp.activateLicense({ code: activationInput.value });
  if (!result.ok) {
    activationError.textContent = result.error;
    activationBtn.disabled = false;
    return;
  }
  showApp(result);
});

async function initLicense() {
  const status = await window.cowayApp.licenseStatus();
  if (machineId) machineId.textContent = status.machineId || "-";
  if (status.activated && !status.expired) showApp(status);
  else showLicense(status);
}

if (copyMachineId) {
  copyMachineId.addEventListener("click", async () => {
    if (!machineId?.textContent) return;
    try {
      await navigator.clipboard.writeText(machineId.textContent);
      copyMachineId.textContent = "Copied";
      setTimeout(() => { copyMachineId.textContent = "Copy Machine ID"; }, 1200);
    } catch {}
  });
}

// Re-check periodically so an expired subscription cannot remain unlocked
// indefinitely while the app is open.
setInterval(async () => {
  if (appView.style.display !== "none") {
    const status = await window.cowayApp.licenseStatus();
    if (!status.activated || status.expired) showLicense(status);
    else showApp(status);
  }
}, 60 * 1000);

const selectBtn = document.getElementById("selectBtn");
const startBtn = document.getElementById("startBtn");
const saveBtn = document.getElementById("saveBtn");
const fileName = document.getElementById("fileName");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const greenCount = document.getElementById("greenCount");
const percent = document.getElementById("percent");
const log = document.getElementById("log");

let selected = false;

function addLog(message) {
  const time = new Date().toLocaleTimeString();
  log.textContent += `\n[${time}] ${message}`;
  log.scrollTop = log.scrollHeight;
}

selectBtn.addEventListener("click", async () => {
  const result = await window.cowayApp.selectExcel();
  if (!result) return;

  selected = true;
  fileName.textContent = result.name;
  startBtn.disabled = false;
  saveBtn.disabled = true;
  progressBar.style.width = "0%";
  progressText.textContent = "0 / 0";
  greenCount.textContent = "0";
  percent.textContent = "0%";
  log.textContent = "Excel selected.";
});

startBtn.addEventListener("click", async () => {
  if (!selected) return;
  startBtn.disabled = true;
  selectBtn.disabled = true;
  saveBtn.disabled = true;
  addLog("Starting checker...");
  const result = await window.cowayApp.startCheck();
  if (!result.ok) {
    addLog(`ERROR: ${result.error}`);
    startBtn.disabled = false;
    selectBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", async () => {
  const result = await window.cowayApp.saveExcel();
  if (result.ok) addLog(`Saved: ${result.path}`);
  else if (!result.canceled) addLog(`ERROR: ${result.error}`);
});

window.cowayApp.onProgress((data) => {
  const pct = data.total ? Math.round((data.current / data.total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${data.current} / ${data.total}`;
  greenCount.textContent = data.green;
  percent.textContent = `${pct}%`;
  if (data.message) addLog(data.message);
});

window.cowayApp.onStatus((data) => {
  if (data.message) addLog(data.message);
  if (data.type === "done") {
    saveBtn.disabled = false;
    startBtn.disabled = false;
    selectBtn.disabled = false;
    progressBar.style.width = "100%";
    percent.textContent = "100%";
  }
  if (data.type === "error") {
    startBtn.disabled = false;
    selectBtn.disabled = false;
  }
});

initLicense();
