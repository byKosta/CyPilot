# How to Share and Publish CyPilot

There are three ways to distribute CyPilot so other developers can use it:

---

## 📦 Option 1: Share the `.vsix` Package (Quickest & Private)
You can distribute the compiled `cypilot-0.0.4.vsix` file directly. Other developers can install it manually:
1. Download the `cypilot-0.0.4.vsix` file.
2. In VS Code, open the Extensions view (`Cmd+Shift+X`).
3. Click the `...` menu in the top-right corner of the Extensions panel.
4. Choose **Install from VSIX...** and select the file.

> **Tip**: You can attach the `.vsix` file to your GitHub repository's **Releases** page so anyone visiting your repository can download and install it in one click.

---

## 🌐 Option 2: Publish to the Official VS Code Marketplace (Recommended)
Publishing to the marketplace makes CyPilot searchable directly inside the VS Code Extensions tab for everyone.

### Step 1: Create a Publisher Account
1. Go to the [Azure DevOps Sign-in Page](https://aex.dev.azure.com) and create or sign in to your Microsoft account.
2. Create an Organization (e.g., `bykosta`).
3. Inside your organization settings, go to **Personal Access Tokens (PAT)**.
4. Click **New Token** and set:
   * **Name**: `cypilot-publisher`
   * **Organization**: All accessible organizations.
   * **Scopes**: Custom defined -> Select **Marketplace** -> check **Acquire** and **Manage**.
5. Copy the generated Personal Access Token (PAT) immediately (you won't be able to see it again).

### Step 2: Create a Publisher on Visual Studio Marketplace
1. Go to the [Visual Studio Marketplace Publisher Management Page](https://marketplace.visualstudio.com/manage).
2. Sign in with the same Microsoft account.
3. Click **Create Publisher** and fill in your details:
   * **ID**: `bykosta` (this must match the `"publisher": "bykosta"` field in `package.json`).
   * **Name**: Your display name.

### Step 3: Publish via CLI
From your terminal inside the `/Users/bykosta/Projects/CyPilot ` directory, login and publish:

1. **Login to your publisher account**:
   ```bash
   npx vsce login bykosta
   ```
   *Paste the Personal Access Token (PAT) you copied in Step 1 when prompted.*

2. **Publish the extension**:
   ```bash
   npx vsce publish
   ```
   *Your extension will be compiled, packaged, uploaded, and will become publicly searchable in VS Code within a few minutes!*

---

## 🔓 Option 3: Publish to Open VSX Registry
Open VSX is an open-source alternative registry used by VSCodium, Gitpod, Eclipse Theia, and others.
1. Sign in to [Open VSX Registry](https://open-vsx.org/).
2. Create a Namespace matching your publisher id (`bykosta`).
3. Generate an Access Token.
4. Publish using `ovsx`:
   ```bash
   npx ovsx publish cypilot-0.0.4.vsix -t <your-open-vsx-token>
   ```
