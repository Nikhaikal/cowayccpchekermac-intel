#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

const toolsDir = __dirname;
const out = path.join(toolsDir, "license-keys");
fs.mkdirSync(out, { recursive: true });

const privatePath = path.join(out, "private.pem");
const publicPath = path.join(out, "public.pem");
fs.writeFileSync(privatePath, privateKey, "utf8");
fs.writeFileSync(publicPath, publicKey, "utf8");

// Also update the public key embedded in the Electron app.
// This lets the admin generate a fresh key pair on the Mac and then build
// an app whose verifier matches that private key.
const mainPath = path.join(__dirname, "..", "src", "main.js");
let main = fs.readFileSync(mainPath, "utf8");

const markerStart = "const ADMIN_PUBLIC_KEY = `";
const markerEnd = "`;";

const start = main.indexOf(markerStart);
if (start === -1) {
  throw new Error("Could not find ADMIN_PUBLIC_KEY in src/main.js");
}

const keyStart = start + markerStart.length;
const end = main.indexOf(markerEnd, keyStart);
if (end === -1) {
  throw new Error("Could not find end of ADMIN_PUBLIC_KEY in src/main.js");
}

main =
  main.slice(0, keyStart) +
  publicKey.trimEnd() +
  main.slice(end);

fs.writeFileSync(mainPath, main, "utf8");

console.log("Admin license key pair created.");
console.log(`PRIVATE KEY: ${privatePath}`);
console.log(`PUBLIC KEY:  ${publicPath}`);
console.log(`APP UPDATED: ${mainPath}`);
console.log("");
console.log("IMPORTANT:");
console.log("- Keep private.pem secret. Never send it to workers.");
console.log("- The public key is embedded into the app automatically.");
console.log("- Run this once before building/distributing your worker app.");
