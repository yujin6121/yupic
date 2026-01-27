# yupic

**English** | [한국어](README.md)

A lightweight and fast cross-platform image viewer

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Introduction

yupic is a high-performance image viewer built with Tauri + React + Rust. It supports various image formats including HEIC, RAW, JPEG XL, and offers lightweight yet fast performance.

## Features

- 🖼️ **Wide Format Support** - HEIC/HEIF, RAW (CR2/NEF/RAF, etc.), JPEG XL, AVIF and more
- ⚡ **Fast Decoding** - Native image processing powered by Rust
- 🎞️ **Animation Support** - GIF, WebP, APNG animation playback
- 🔍 **Zoom & Pan** - Mouse wheel zoom, drag to navigate
- 🔄 **Rotate & Flip** - 90° rotation, horizontal/vertical flip
- 📁 **Folder Navigation** - Browse images in the same folder (←/→ keys)
- 📊 **EXIF Metadata** - View shooting info and camera settings
- 🌙 **Dark/Light Theme** - Theme support matching system settings
- 🌐 **Multi-language** - Korean, English

## Supported Formats

| Category | Formats |
|----------|---------|
| Common | JPEG, PNG, GIF, BMP, WebP, AVIF |
| Apple | HEIC, HEIF |
| RAW | CR2, NEF, ARW, RAF, ORF, RW2, DNG, etc. |
| Next-gen | JPEG XL (JXL), QOI |
| Other | TIFF, TGA, ICO, DDS, PNM |

## Installation

### Download Release

Download the latest version from the [Releases](https://github.com/yujin6121/yupic/releases) page:

- **macOS**: `.dmg` file
- **Windows**: `.msi` or `.exe` installer

## Troubleshooting

### macOS: "App is damaged and can't be opened"

Apps not signed with an Apple Developer certificate may be blocked by macOS Gatekeeper. You can resolve this by running the following command in the terminal:

1. Move the app to the **Applications** folder.
2. Open Terminal.app and enter the following command:
   ```bash
   sudo xattr -cr /Applications/yupic.app
   ```
3. Launch the app again.

### Build from Source

See [BUILD.md](BUILD.md) for build instructions.

## Development Setup

### Requirements

- Node.js 18+
- Rust 1.70+
- macOS: libheif (`brew install libheif`)

### Run Development Server

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Build

```bash
# Release build
npm run tauri build
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous/Next image |
| `+` / `-` | Zoom in/out |
| `0` | Reset zoom (original size) |
| `R` | Rotate 90° clockwise |
| `H` | Flip horizontal |
| `V` | Flip vertical |
| `I` | Toggle info panel |
| `F` | Toggle fullscreen |
| `Esc` | Exit fullscreen |

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Rust, Tauri 2.0
- **Image Processing**: image-rs, libheif-rs, rawloader, jxl-oxide

## License

MIT License

## Contributing

Bug reports, feature suggestions, and PRs are welcome!
