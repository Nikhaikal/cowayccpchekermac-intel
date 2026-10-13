const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");

// This MUST run before `require("playwright")` below. Playwright reads
// PLAYWRIGHT_BROWSERS_PATH once, at import time, to build its internal
// registry of where to look for browsers — setting it later (e.g. right
// before launch()) has no effect, because the registry is already built
// by then. That mismatch was the cause of "Executable doesn't exist at
// ...ms-playwright\..." errors even in packaged builds that do bundle
// their own Chromium.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, "playwright-browsers");
}

const crypto = require("crypto");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { chromium } = require("playwright");

let mainWindow;
let selectedFile = null;
let outputFile = null;
let running = false;

const LICENSE_FILE = () => path.join(app.getPath("userData"), "license.json");

// Public key used by the app to verify licenses. Keep the matching PRIVATE key
// only on the administrator's machine. Never distribute the private key.
const ADMIN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAuO0+i3VLxnN7RbA4W32n
qd8EAs4FUuKyWmagE6iMFT2nts0pGLXUBcjePs90bbRn0dPCZyWoeOsoYiFFrClG
GEZnKiYWGsvc/CMY7bjcv6Jz+iU00/OEV+NE1flnHMnpvZPAvWuBlCVelCHzbVOR
/eflZoCrbcVH65lBhMw/wHtcUgBwsKxB1j0yU7i82JdX0PoV1qAUDLn51TrLzols
OMwD2Q+QSB7g9/uLOrREkpOTe/WvnkGrP9h764YWFQuxbC5Tc3z8MPXRXwb82ZPO
CHWb90e6HCU8lQpJ4PrV0fMQaii000qagZjAjlwABMaeIQyK183cDmaNRxAy4hGy
BFfZsMEp+8I7NPG2a1nELMxxSFwR7QMlnqr3YsOGm7CSNIuY8ktfDX82auVUoh2U
i+juU3g9JSvbpieJ92tfsJKZLnYxoD95e23rx/u2aE86lJ9r8jqQKQeJiajeL90b
3e15NwNJUr3YojA0R4i7fEpI6OqxWrDwvSFQdePrLJWDAgMBAAE=
-----END PUBLIC KEY-----`;

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function readLicense() {
  try {
    return JSON.parse(fs.readFileSync(LICENSE_FILE(), "utf8"));
  } catch {
    return null;
  }
}

function writeLicense(license) {
  fs.mkdirSync(path.dirname(LICENSE_FILE()), { recursive: true });
  fs.writeFileSync(LICENSE_FILE(), JSON.stringify(license, null, 2), "utf8");
}

function normalizeCode(code) {
  return String(code || "").trim().replace(/\s+/g, "");
}

function getMachineId() {
  if (process.platform === "win32") {
    try {
      const { execFileSync } = require("child_process");
      const output = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8", windowsHide: true }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/i);
      if (match && match[1]) return `WIN-${match[1].trim().toUpperCase()}`;
    } catch {}
  }

  if (process.platform === "darwin") {
    try {
      const { execFileSync } = require("child_process");
      const output = execFileSync(
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        { encoding: "utf8" }
      );
      const match = output.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) return `MAC-${match[1].trim().toUpperCase()}`;
    } catch {}
  }

  // Fallback for other platforms. It is stable enough for the intended local
  // subscription use case, but Windows/macOS use stronger OS identifiers above.
  return `HOST-${require("os").hostname().toUpperCase()}`;
}

function verifyLicenseSignature(body, signature) {
  try {
    if (ADMIN_PUBLIC_KEY.includes("REPLACE_WITH_YOUR_ADMIN_PUBLIC_KEY")) {
      return false;
    }
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(body);
    verify.end();
    return verify.verify(ADMIN_PUBLIC_KEY, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

function parseActivationCode(rawCode) {
  const code = normalizeCode(rawCode);
  // COWAY + base64url(JSON payload) + base64url(RSA signature)
  if (!code.startsWith("COWAY") || code.length < 20) {
    return { ok: false, error: "Invalid activation code." };
  }

  const encoded = code.slice(5);
  // The signature is variable length after base64url encoding, so try the
  // separator used by the generator instead of relying on fixed positions.
  const separatorIndex = encoded.lastIndexOf(".");
  if (separatorIndex < 1) return { ok: false, error: "Invalid activation code." };

  const body = encoded.slice(0, separatorIndex);
  const signature = encoded.slice(separatorIndex + 1);

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid activation code." };
  }

  if (!verifyLicenseSignature(body, signature)) {
    return { ok: false, error: "Invalid activation code." };
  }

  if (
    !payload ||
    payload.v !== 2 ||
    !Number.isFinite(payload.expiresAt) ||
    typeof payload.machineId !== "string" ||
    !payload.licenseId
  ) {
    return { ok: false, error: "Invalid activation code." };
  }

  if (payload.machineId !== getMachineId()) {
    return { ok: false, error: "This activation code belongs to another computer." };
  }

  if (payload.expiresAt <= Date.now()) {
    return { ok: false, error: "This activation code has expired." };
  }

  return { ok: true, payload };
}

function licenseStatus() {
  const license = readLicense();
  if (!license) return { activated: false, expired: false, machineId: getMachineId() };

  const now = Date.now();
  const clockRolledBack = Number.isFinite(license.lastSeenAt) && now + MAX_CLOCK_SKEW_MS < license.lastSeenAt;
  const wrongMachine = license.machineId !== getMachineId();
  const expired = clockRolledBack || wrongMachine || !license.expiresAt || now >= license.expiresAt;

  return {
    activated: true,
    expired,
    expiresAt: license.expiresAt,
    activatedAt: license.activatedAt,
    daysRemaining: expired ? 0 : Math.ceil((license.expiresAt - now) / 86400000),
    clockRolledBack,
    wrongMachine,
    machineId: getMachineId()
  };
}

function activateLicense(rawCode) {
  const result = parseActivationCode(rawCode);
  if (!result.ok) return result;

  const existing = readLicense();
  if (existing && existing.machineId === getMachineId() && existing.expiresAt > Date.now()) {
    return { ok: false, error: "A subscription is already active on this computer." };
  }

  const now = Date.now();
  const license = {
    licenseId: result.payload.licenseId,
    code: normalizeCode(rawCode),
    machineId: result.payload.machineId,
    activatedAt: now,
    expiresAt: result.payload.expiresAt,
    lastSeenAt: now
  };
  writeLicense(license);
  return { ok: true, ...licenseStatus() };
}

function ensureLicenseActive() {
  const status = licenseStatus();
  if (!status.activated) return { ok: false, error: "Subscription required." };
  if (status.expired) {
    let message = "Subscription expired. Please enter a new activation code.";
    if (status.clockRolledBack) {
      message = "Computer date/time was moved backwards. Correct the date/time and restart the app.";
    } else if (status.wrongMachine) {
      message = "This subscription belongs to another computer.";
    }
    return { ok: false, error: message };
  }

  const license = readLicense();
  if (license) {
    license.lastSeenAt = Date.now();
    writeLicense(license);
  }
  return { ok: true, status };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 650,
    minHeight: 520,
    title: "Coway IC Checker",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("license-status", async () => licenseStatus());

ipcMain.handle("activate-license", async (_, { code }) => activateLicense(code));

ipcMain.handle("select-excel", async () => {
  const access = ensureLicenseActive();
  if (!access.ok) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Excel file",
    properties: ["openFile"],
    filters: [{ name: "Excel files", extensions: ["xlsx"] }]
  });

  if (result.canceled || !result.filePaths.length) return null;

  selectedFile = result.filePaths[0];
  outputFile = path.join(
    path.dirname(selectedFile),
    `${path.basename(selectedFile, path.extname(selectedFile))}_checked.xlsx`
  );

  return {
    input: selectedFile,
    output: outputFile,
    name: path.basename(selectedFile)
  };
});

ipcMain.handle("start-check", async () => {
  const access = ensureLicenseActive();
  if (!access.ok) return access;
  if (running) return { ok: false, error: "A check is already running." };
  if (!selectedFile) return { ok: false, error: "Select an Excel file first." };

  running = true;

  try {
    await runChecker(selectedFile, outputFile);
    return { ok: true, output: outputFile };
  } catch (error) {
    send("status", {
      type: "error",
      message: error.message || String(error)
    });
    return { ok: false, error: error.message || String(error) };
  } finally {
    running = false;
  }
});

ipcMain.handle("save-excel", async () => {
  const access = ensureLicenseActive();
  if (!access.ok) return access;
  if (!outputFile || !fs.existsSync(outputFile)) {
    return { ok: false, error: "No completed output file is available." };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save checked Excel file",
    defaultPath: path.basename(outputFile),
    filters: [{ name: "Excel files", extensions: ["xlsx"] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  fs.copyFileSync(outputFile, result.filePath);
  return { ok: true, path: result.filePath };
});

function clearRowFill(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "none"
    };
  });
}



function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

async function runChecker(inputFile, outputPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFile);

  const worksheet =
    workbook.getWorksheet("Sheet1") || workbook.worksheets[0];

  if (!worksheet) throw new Error("No worksheet found.");

  // Match the current script: ICs are in column F and data starts at row 2.
  const IC_COLUMN = "F";
  const START_ROW = 2;

  const rows = [];

  for (let rowNumber = START_ROW; rowNumber <= worksheet.rowCount; rowNumber++) {
    const value = worksheet.getCell(`${IC_COLUMN}${rowNumber}`).value;

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      rows.push({
        rowNumber,
        ic: String(value).trim()
      });
    }
  }

  if (!rows.length) {
    throw new Error(`No IC numbers found in column ${IC_COLUMN}.`);
  }

  send("progress", {
    current: 0,
    total: rows.length,
    green: 0,
    message: `Found ${rows.length} IC number(s).`
  });

  // PLAYWRIGHT_BROWSERS_PATH is already set (see top of file, before the
  // playwright import) for packaged builds. Development builds fall back
  // to the normal Playwright browser cache in that user's home folder.
  const browserOptions = { headless: false };
  if (app.isPackaged) {
    // Prefer the browser installed in the application's resources directory.
    // Fail with a diagnostic instead of displaying Playwright's misleading
    // instruction to run npm/npx on the customer's machine.
    const browserPath = chromium.executablePath();
    const browserRoot = path.join(process.resourcesPath, "playwright-browsers");
    if (!fs.existsSync(browserPath)) {
      throw new Error(
        "Bundled Chromium was not found. Expected: " + browserPath +
        "\\nBrowser resources directory: " + browserRoot +
        "\\nPlease reinstall the latest Coway IC Checker build."
      );
    }
    browserOptions.executablePath = browserPath;
  }
  const browser = await chromium.launch(browserOptions);

  const page = await browser.newPage();

  try {
    await page.goto("https://etrust.my.coway.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    send("status", {
      type: "info",
      message: "Log in to eTRUST in the browser window. The checker will continue after login."
    });

    await page.getByRole("link", { name: "Sales" }).waitFor({
      state: "visible",
      timeout: 120000
    });

    await page.getByRole("link", { name: "Sales" }).click();
    await page.getByRole("link", { name: "Order" }).click();
    await page.getByRole("link", { name: "i-Care Eligibility" }).click();

    const frame = page.frameLocator(
      'iframe[name="frame-SAL01021100"]'
    );

    await frame.getByRole("textbox", {
      name: "NRIC/Company No"
    }).waitFor({
      state: "visible",
      timeout: 15000
    });

    let greenCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];

      try {
        const icInput = frame.getByRole("textbox", {
          name: "NRIC/Company No"
        });

        await icInput.fill(item.ic);
        await frame.getByRole("link", { name: "Search" }).click();

        // Give eTRUST enough time to replace the previous result.
        // We deliberately do not refresh the page between ICs.
        await page.waitForTimeout(2500);

        // Detect ONLY a visible element whose own text is exactly GREEN.
        // This avoids treating "NOT GREEN" as GREEN and avoids matching
        // explanatory text that merely contains the word GREEN.
        let isGreen = false;
        try {
          const green = frame.locator(
            'xpath=//*[normalize-space(text())="GREEN"]'
          ).first();

          await green.waitFor({
            state: "visible",
            timeout: 7500
          });

          const resultText = (await green.innerText()).trim().toUpperCase();
          isGreen = resultText === "GREEN";
        } catch {
          isGreen = false;
        }

        send("status", {
          type: "info",
          message: `IC ${item.ic}: ${isGreen ? "GREEN detected" : "NOT GREEN / no GREEN result"}`
        });

        console.log("========== EXCEL COLOR CHECK ==========");
        console.log("IC:", item.ic);
        console.log("Row:", item.rowNumber);
        console.log("isGreen:", isGreen);
        console.log("isGreen type:", typeof isGreen);

        if (isGreen === true) {
          console.log(">>> COLORING ROW", item.rowNumber);
          colorRowGreen(worksheet.getRow(item.rowNumber));
          greenCount++;
        } else {
          console.log(">>> NOT COLORING ROW", item.rowNumber);
        }

        send("progress", {
          current: i + 1,
          total: rows.length,
          green: greenCount,
          message: isGreen === true
            ? `Row ${item.rowNumber}: GREEN`
            : `Row ${item.rowNumber}: not GREEN`
        });
      } catch (error) {
        send("progress", {
          current: i + 1,
          total: rows.length,
          green: greenCount,
          message: `Row ${item.rowNumber}: error — continuing`
        });
      }

      await page.waitForTimeout(500);
    }

    await workbook.xlsx.writeFile(outputPath);

    send("status", {
      type: "done",
      message: `Finished. ${greenCount} row(s) marked GREEN.`,
      output: outputPath
    });
  } finally {
    await browser.close();
  }
}

function colorRowGreen(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    // IMPORTANT: clone the cell's existing style before changing the fill.
    // ExcelJS can share style objects between cells; mutating the shared
    // style would make NON-GREEN rows inherit the green fill.
    cell.style = {
      ...cell.style,
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFB3E6B3" }
      }
    };
  });
}
