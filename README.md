# 3D Viewer (STL / 3MF)

Desktop 3D model viewer built with Tauri and Three.js.  
Supports loading `.stl` and `.3mf` files, model inspection, rotation gizmo, measurements, and drag-and-drop.

## Technologies

- Tauri 2 (Rust backend + desktop shell)
- Three.js (3D rendering)
- Vite (frontend dev server + build)
- Vanilla JavaScript, HTML, CSS
- Bootswatch / Bootstrap 5 (UI styling)

## Requirements

- Node.js + npm
- Rust toolchain (`rustup`, `cargo`)
- Tauri prerequisites for your OS

## Development

Install dependencies:

```bash
npm install
```

Run app in development mode:

```bash
npm run tauri dev
```

Run frontend only (without desktop shell):

```bash
npm run dev
```

## Build

Build frontend assets:

```bash
npm run build
```

Build desktop app bundle:

```bash
npm run tauri build
```

## Quick checks

Frontend syntax check:

```bash
node --check src/main.js
```

Rust compile check:

```bash
cd src-tauri
cargo check
```
