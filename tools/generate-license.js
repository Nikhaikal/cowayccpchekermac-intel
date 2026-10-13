#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const days = Number(process.argv[2] || 30);
const machineId = String(process.argv[3] || "").trim().toUpperCase();
const privateKeyPath = path.join(__dirname, "license-keys", "private.pem");

if (!Number.isInteger(days) || days <= 0 || !machineId) {
  console.error("Usage: node tools/generate-license.js <days> <machine-id>");
  process.exit(1);
}
if (!fs.existsSync(privateKeyPath)) {
  console.error("Admin key not found. Run: node tools/generate-keypair.js");
  process.exit(1);
}

const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
const payload = {
  v: 2,
  licenseId: crypto.randomUUID(),
  machineId,
  expiresAt
};

const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signer = crypto.createSign("RSA-SHA256");
signer.update(body);
signer.end();
const signature = signer.sign(fs.readFileSync(privateKeyPath, "utf8")).toString("base64url");
const code = `COWAY${body}.${signature}`;

console.log(`Subscription: ${days} days`);
console.log(`Machine ID: ${machineId}`);
console.log(`Expires: ${new Date(expiresAt).toLocaleString()}`);
console.log(`Activation code:\n${code}`);
