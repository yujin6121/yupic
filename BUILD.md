# yupic 빌드 가이드

## 공통 요구사항

- Node.js 18+
- Rust (https://rustup.rs/)
- npm 또는 pnpm

---

## macOS 빌드

### 1. 사전 설치

```bash
# Homebrew 설치 (없는 경우)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Rust 설치
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# libheif 설치 (HEIC 지원용)
brew install libheif
```

### 2. 빌드 타겟 추가

```bash
# Apple Silicon (M1/M2/M3)
rustup target add aarch64-apple-darwin

# Intel Mac
rustup target add x86_64-apple-darwin
```

### 3. 빌드 실행

```bash
# 의존성 설치
npm install

# 현재 아키텍처용 빌드
npm run tauri build

# Apple Silicon (ARM64) 전용 빌드
npm run tauri build -- --target aarch64-apple-darwin

# Intel (x64) 전용 빌드
npm run tauri build -- --target x86_64-apple-darwin

# Universal Binary (둘 다 포함)
npm run tauri build -- --target universal-apple-darwin
```

### 4. 빌드 결과물

```
src-tauri/target/release/bundle/
├── dmg/
│   └── yupic_0.1.0_aarch64.dmg   # 설치용 DMG
└── macos/
    └── yupic.app                  # 앱 번들
```

---

## Windows 빌드

### 1. 사전 설치

**필수 프로그램:**

1. **Visual Studio Build Tools** (C++ 빌드 도구)
   - https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - 설치 시 "C++를 사용한 데스크톱 개발" 워크로드 선택

2. **Rust 설치**
   ```powershell
   # PowerShell에서 실행
   winget install Rustlang.Rustup
   # 또는 https://rustup.rs/ 에서 다운로드
   ```

3. **Node.js 설치**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

4. **WebView2** (Windows 10 이하에서 필요, Windows 11은 기본 포함)
   - https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 2. 빌드 타겟 추가

```powershell
# 64비트 (가장 일반적)
rustup target add x86_64-pc-windows-msvc

# 32비트
rustup target add i686-pc-windows-msvc

# ARM64 (Surface Pro X 등)
rustup target add aarch64-pc-windows-msvc
```

### 3. 빌드 실행

```powershell
# 의존성 설치
npm install

# 현재 아키텍처용 빌드
npm run tauri build

# 64비트 전용 빌드
npm run tauri build -- --target x86_64-pc-windows-msvc

# 32비트 전용 빌드
npm run tauri build -- --target i686-pc-windows-msvc

# ARM64 전용 빌드
npm run tauri build -- --target aarch64-pc-windows-msvc
```

### 4. 빌드 결과물

```
src-tauri/target/release/bundle/
├── msi/
│   └── yupic_0.1.0_x64_en-US.msi   # MSI 설치 파일
└── nsis/
    └── yupic_0.1.0_x64-setup.exe   # NSIS 설치 파일
```

---

## 빌드 옵션

### 릴리스 빌드 (기본값)
```bash
npm run tauri build
```

### 디버그 빌드 (개발용)
```bash
npm run tauri build -- --debug
```

### 특정 기능만 포함
```bash
# HEIF만 포함 (기본값)
npm run tauri build

# HEIF + RAW 포함
npm run tauri build -- --features heif,raw

# 모든 기능 포함
npm run tauri build -- --features heif,jxl,raw
```

---

## 문제 해결

### macOS: "libheif not found"
```bash
brew install libheif
export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:$PKG_CONFIG_PATH"
```

### Windows: "MSVC not found"
Visual Studio Build Tools를 설치하고 "C++를 사용한 데스크톱 개발"을 선택했는지 확인하세요.

### 공통: Rust 컴파일 오류
```bash
# Rust 업데이트
rustup update stable
```

---

## 빌드 타겟 요약

| 플랫폼 | 아키텍처 | 타겟 이름 |
|--------|----------|-----------|
| macOS | ARM64 (M1/M2/M3) | `aarch64-apple-darwin` |
| macOS | Intel x64 | `x86_64-apple-darwin` |
| macOS | Universal | `universal-apple-darwin` |
| Windows | 64비트 | `x86_64-pc-windows-msvc` |
| Windows | 32비트 | `i686-pc-windows-msvc` |
| Windows | ARM64 | `aarch64-pc-windows-msvc` |

---

## GitHub Actions 빌드 (CI/CD)

GitHub에 저장소를 올리면 자동으로 모든 플랫폼 빌드를 실행할 수 있습니다.

### 1. 워크플로우 파일 생성

`.github/workflows/build.yml` 파일을 생성합니다:

```yaml
name: Build yupic

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:  # 수동 실행 허용

jobs:
  build-macos:
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: aarch64-apple-darwin
            name: macOS-arm64
          - target: x86_64-apple-darwin
            name: macOS-x64

    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install dependencies (macOS)
        run: brew install libheif

      - name: Install frontend dependencies
        run: npm install

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          args: --target ${{ matrix.target }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: yupic-${{ matrix.name }}
          path: |
            src-tauri/target/${{ matrix.target }}/release/bundle/dmg/*.dmg
            src-tauri/target/${{ matrix.target }}/release/bundle/macos/*.app

  build-windows:
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: x86_64-pc-windows-msvc
            name: Windows-x64
          - target: i686-pc-windows-msvc
            name: Windows-x86
          - target: aarch64-pc-windows-msvc
            name: Windows-arm64

    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install frontend dependencies
        run: npm install

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          args: --target ${{ matrix.target }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: yupic-${{ matrix.name }}
          path: |
            src-tauri/target/${{ matrix.target }}/release/bundle/msi/*.msi
            src-tauri/target/${{ matrix.target }}/release/bundle/nsis/*.exe

  release:
    needs: [build-macos, build-windows]
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/')
    permissions:
      contents: write
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: artifacts/**/*
          draft: true
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 2. 사용 방법

#### 수동 빌드 실행
1. GitHub 저장소의 **Actions** 탭으로 이동
2. 왼쪽에서 "Build yupic" 워크플로우 선택
3. **Run workflow** 버튼 클릭

#### 릴리스 빌드 (태그 푸시)
```bash
# 버전 태그 생성 및 푸시
git tag v0.1.0
git push origin v0.1.0
```

태그를 푸시하면:
1. 모든 플랫폼(macOS ARM64/x64, Windows x64/x86/ARM64) 빌드 실행
2. 빌드 완료 후 GitHub Release 드래프트 자동 생성
3. 모든 설치 파일이 Release에 첨부됨

### 3. 빌드 결과물 다운로드

- **Actions** → 실행된 워크플로우 선택 → **Artifacts** 섹션에서 다운로드
- 또는 **Releases** 페이지에서 최종 배포 파일 다운로드

### 4. 빌드되는 파일 목록

| 아티팩트 이름 | 포함 파일 |
|---------------|-----------|
| `yupic-macOS-arm64` | `.dmg`, `.app` (Apple Silicon) |
| `yupic-macOS-x64` | `.dmg`, `.app` (Intel Mac) |
| `yupic-Windows-x64` | `.msi`, `.exe` (64비트) |
| `yupic-Windows-x86` | `.msi`, `.exe` (32비트) |
| `yupic-Windows-arm64` | `.msi`, `.exe` (ARM64) |

