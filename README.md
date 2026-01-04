# yupic

[English](README_EN.md) | **한국어**

가볍고 빠른 크로스 플랫폼 이미지 뷰어

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 소개

yupic은 Tauri + React + Rust로 구축된 고성능 이미지 뷰어입니다. HEIC, RAW, JPEG XL 등 다양한 이미지 포맷을 지원하며, 가볍고 빠른 성능을 제공합니다.

## 주요 기능

- 🖼️ **다양한 포맷 지원** - HEIC/HEIF, RAW (CR2/NEF/RAF 등), JPEG XL, AVIF 외 다수
- ⚡ **빠른 디코딩** - Rust 기반 네이티브 이미지 처리
- 🎞️ **애니메이션 지원** - GIF, WebP, APNG 애니메이션 재생
- 🔍 **줌 & 팬** - 마우스 휠 줌, 드래그로 이미지 탐색
- 🔄 **회전 & 반전** - 90도 회전, 좌우/상하 반전
- 📁 **폴더 탐색** - 같은 폴더 내 이미지 순차 탐색 (←/→ 키)
- 📊 **EXIF 메타데이터** - 촬영 정보, 카메라 설정 확인
- 🌙 **다크/라이트 테마** - 시스템 설정에 맞춘 테마 지원
- 🌐 **다국어 지원** - 한국어, 영어

## 지원 포맷

| 카테고리 | 포맷 |
|----------|------|
| 일반 | JPEG, PNG, GIF, BMP, WebP, AVIF |
| Apple | HEIC, HEIF |
| RAW | CR2, NEF, ARW, RAF, ORF, RW2, DNG 등 |
| 차세대 | JPEG XL (JXL), QOI |
| 기타 | TIFF, TGA, ICO, DDS, PNM |

## 설치

### 릴리스 다운로드

[Releases](https://github.com/yujin6121/yupic/releases) 페이지에서 최신 버전을 다운로드하세요:

- **macOS**: `.dmg` 파일
- **Windows**: `.msi` 또는 `.exe` 설치 파일

## 단축키

| 키 | 동작 |
|----|------|
| `←` / `→` | 이전/다음 이미지 |
| `+` / `-` | 줌 인/아웃 |
| `0` | 줌 리셋 (원본 크기) |
| `R` | 시계 방향 90도 회전 |
| `H` | 좌우 반전 |
| `V` | 상하 반전 |
| `I` | 정보 패널 토글 |
| `F` | 전체 화면 토글 |
| `Esc` | 전체 화면 해제 |

## 기술 스택

- **Frontend**: React, TypeScript, Vite
- **Backend**: Rust, Tauri 2.0
- **이미지 처리**: image-rs, libheif-rs, rawloader, jxl-oxide

## 라이선스

MIT License

## 기여

버그 리포트, 기능 제안, PR 환영합니다!
