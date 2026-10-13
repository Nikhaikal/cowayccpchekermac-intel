# Build Coway IC Checker for Intel and Apple Silicon Macs from Windows

These installers must be produced on macOS. GitHub Actions provides Mac machines that you can start from your Windows browser. The Windows computer does NOT create the DMG itself.

## One-time setup
1. Unzip this project on Windows. Keep your original `tools/license-keys/private.pem` in your own safe local backup; it has deliberately been excluded from this shared project.
2. Create a **private** GitHub repository (or use an existing repository that you control). The app's public verification key is embedded in `src/main.js` already, so the build does not require your private key.
3. Upload/commit the project contents to the repository, including the hidden `.github/workflows/build-macos.yml` file. Do not upload `node_modules`, `dist`, or any `private.pem`.
4. In GitHub, open **Actions** > **Build macOS installers** > **Run workflow** > **Run workflow**.
5. When the run completes, open the run and download the two artifacts:
   - `Coway-IC-Checker-mac-x64` for **Intel Macs**
   - `Coway-IC-Checker-mac-arm64` for **Apple Silicon (M-series)**
6. Extract the artifact ZIP to access the generated `.dmg` and distributable app ZIP.

## Local Mac build (if you have access to a Mac)
Install Node.js 22, open Terminal in the project folder, then run:

```sh
npm ci
npm run dist:mac        # Apple Silicon (run on Apple Silicon Mac)
# OR
npm run dist:mac-intel  # Intel (run on Intel Mac)
```

The `dist` directory contains `.dmg` and `.zip` installers. The bundled Chromium must match the build architecture, so **do not** use the all-architectures command on a single machine unless you've separately provisioned browsers for both architectures.

## macOS security warning
These builds are **unsigned and unnotarized**. macOS Gatekeeper may block them. The recipient can use Finder > right-click the app > Open (or System Settings > Privacy & Security > Open Anyway when offered). For regular customer distribution, set up Apple Developer ID signing and notarization.

## Licensing warning
The packaged app contains only the **public** verification key, not a license generator or `private.pem`. Keep your existing private key safe if you want previously issued codes to remain valid. If that key was exposed publicly, rotate the keypair and plan to reissue codes.

## Windows-only alternative
A native Windows command cannot reliably produce a macOS DMG. Building on GitHub-hosted macOS is the recommended Windows-based workflow. GitHub Actions availability and minutes depend on your GitHub plan.
