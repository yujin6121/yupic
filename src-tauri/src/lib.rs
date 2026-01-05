use base64::Engine;
use serde::Serialize;
use std::io::BufReader;
use std::path::{Path, PathBuf};

const MAX_ANIM_FRAMES: usize = 300;

#[cfg(feature = "heif")]
use libheif_rs::{ColorSpace, HeifContext, RgbChroma};
#[cfg(feature = "jxl")]
use jxl_oxide::JxlImage;
#[cfg(feature = "raw")]
use rawloader::{decode_file, RawImageData};
#[cfg(feature = "raw")]
use rayon::prelude::*;

#[derive(Serialize)]
struct ImageFrame {
    width: u32,
    height: u32,
    delay_ms: u32,
    data: String,
}

#[derive(Serialize)]
struct ImageResponse {
    path: String,
    format: String,
    frames: Vec<ImageFrame>,
}

#[derive(Serialize)]
struct DirectoryImages {
    images: Vec<String>,
}

#[derive(Serialize)]
struct MetadataEntry {
    tag: String,
    value: String,
}

#[derive(Serialize)]
struct MetadataResponse {
    path: String,
    entries: Vec<MetadataEntry>,
}

#[tauri::command]
fn get_directory_images(path: &str) -> Result<DirectoryImages, String> {
    let path_buf = PathBuf::from(path);
    let dir = path_buf.parent().ok_or("no parent directory")?;
    
    let mut images = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory: {e}"))?;
    
    let extensions = [
        "bmp", "jpg", "jpeg", "gif", "png", "psd", "dds", "jxr", "webp",
        "j2k", "jp2", "tga", "tiff", "tif", "pcx", "pgm", "pnm", "ppm",
        "bpg", "dng", "cr2", "crw", "nef", "nrw", "orf", "rw2", "pef",
        "sr2", "arw", "raw", "raf", "avif", "jxl", "exr", "qoi", "ico", "svg", "heic",
        "heif",
    ];
    
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if let Some(ext_str) = ext.to_str() {
                    if extensions.contains(&ext_str.to_ascii_lowercase().as_str()) {
                        if let Some(path_str) = entry_path.to_str() {
                            images.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }
    
    images.sort();
    Ok(DirectoryImages { images })
}

#[tauri::command]
fn get_metadata(path: &str) -> Result<MetadataResponse, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("failed to open file for metadata: {e}"))?;
    let mut reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = exif_reader
        .read_from_container(&mut reader)
        .map_err(|e| format!("failed to read exif: {e}"))?;

    let mut entries = Vec::new();
    for f in exif.fields() {
        let tag = format!("{}", f.tag);
        let value = f.display_value().with_unit(&exif).to_string();
        entries.push(MetadataEntry { tag, value });
    }

    Ok(MetadataResponse {
        path: path.to_string(),
        entries,
    })
}

#[tauri::command]
async fn open_image(path: String, max_size: Option<u32>) -> Result<ImageResponse, String> {
    // Force rebuild for feature flags
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err("file not found".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let ext = path_buf
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        let (frames, format) = match ext.as_str() {
            "gif" => decode_gif(&path_buf, max_size)?,
            "avif" => {
                let (frame, fmt) = decode_static_image(&path_buf, max_size)?;
                (vec![frame], fmt)
            }
            "heic" | "heif" => {
                #[cfg(feature = "heif")]
                {
                    decode_heif(&path_buf, max_size)?
                }
                #[cfg(not(feature = "heif"))]
                {
                    return Err("HEIF/HEIC 지원을 빌드 옵션 heif로 활성화하세요".into());
                }
            }
            "jxl" => {
                #[cfg(feature = "jxl")]
                {
                    decode_jxl(&path_buf, max_size)?
                }
                #[cfg(not(feature = "jxl"))]
                {
                    return Err("JXL 지원을 빌드 옵션 jxl로 활성화하세요".into());
                }
            }
            "dng" | "cr2" | "crw" | "nef" | "nrw" | "orf" | "rw2" | "pef" | "sr2" | "arw" | "raw" | "raf" => {
                #[cfg(feature = "raw")]
                {
                    decode_raw(&path_buf, max_size)?
                }
                #[cfg(not(feature = "raw"))]
                {
                    return Err("RAW 기능이 활성화되지 않았습니다. 서버를 재시작해주세요.".into());
                }
            }
            _ => {
                let (frame, fmt) = decode_static_image(&path_buf, max_size)?;
                (vec![frame], fmt)
            }
        };

        if frames.is_empty() {
            return Err("no frames decoded".into());
        }

        Ok(ImageResponse {
            path: path_buf.display().to_string(),
            format,
            frames,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn resize_if_needed(img: image::DynamicImage, max_size: Option<u32>) -> image::DynamicImage {
    if let Some(max) = max_size {
        if max > 0 && (img.width() > max || img.height() > max) {
            // Use Nearest for very large images (>8MP), Triangle otherwise
            let pixels = img.width() as u64 * img.height() as u64;
            let filter = if pixels > 8_000_000 {
                image::imageops::FilterType::Nearest
            } else {
                image::imageops::FilterType::Triangle
            };
            return img.resize(max, max, filter);
        }
    }
    img
}

fn decode_static_image(path: &Path, max_size: Option<u32>) -> Result<(ImageFrame, String), String> {
    let mut reader = image::ImageReader::open(path)
        .map_err(|err| format!("failed to open file {}: {err}", path.display()))?;
    
    // Disable memory limits for faster decoding (we control max_size ourselves)
    reader.no_limits();
    
    let reader = reader.with_guessed_format()
        .map_err(|err| format!("failed to guess format for {}: {err}", path.display()))?;

    let format = reader
        .format()
        .map(|fmt| format!("{fmt:?}"))
        .unwrap_or_else(|| "unknown".into());

    let decoded = reader
        .decode()
        .map_err(|err| format!("failed to decode image {}: {err}", path.display()))?;
    
    let resized = resize_if_needed(decoded, max_size);
    let rgba = resized.to_rgba8();
    let width = rgba.width();
    let height = rgba.height();
    let data = base64::engine::general_purpose::STANDARD.encode(rgba.into_raw());

    Ok((
        ImageFrame {
            width,
            height,
            delay_ms: 0,
            data,
        },
        format,
    ))
}

fn decode_gif(path: &Path, max_size: Option<u32>) -> Result<(Vec<ImageFrame>, String), String> {
    use image::codecs::gif::GifDecoder;
    use image::AnimationDecoder;
    use std::fs::File;

    let file = File::open(path).map_err(|err| format!("failed to open gif: {err}"))?;
    let reader = BufReader::new(file);
    let decoder = GifDecoder::new(reader).map_err(|err| format!("failed to read gif: {err}"))?;
    let frames = decoder
        .into_frames()
        .collect_frames()
        .map_err(|err| format!("failed to collect gif frames: {err}"))?;

    let capped = if frames.len() > MAX_ANIM_FRAMES {
        frames.into_iter().take(MAX_ANIM_FRAMES).collect()
    } else {
        frames
    };

    let mut out = Vec::with_capacity(capped.len());
    for frame in capped {
        let delay: image::Delay = frame.delay();
        let (num, denom) = delay.numer_denom_ms();
        let delay_ms = if denom == 0 {
            num
        } else {
            let ms = (num as f32 / denom as f32).round() as u32;
            ms.max(10)
        };

        let buffer = frame.into_buffer();
        let dynamic = image::DynamicImage::ImageRgba8(buffer);
        let resized = resize_if_needed(dynamic, max_size);
        let rgba = resized.to_rgba8();
        
        let width = rgba.width();
        let height = rgba.height();
        let data = base64::engine::general_purpose::STANDARD.encode(rgba.into_raw());

        out.push(ImageFrame {
            width,
            height,
            delay_ms,
            data,
        });
    }

    Ok((out, "gif".into()))
}

#[cfg(feature = "heif")]
fn decode_heif(_path: &Path, max_size: Option<u32>) -> Result<(Vec<ImageFrame>, String), String> {
    use libheif_rs::LibHeif;
    
    let path_str = _path
        .to_str()
        .ok_or_else(|| "invalid heif path".to_string())?;

    let lib_heif = LibHeif::new();
    let ctx = HeifContext::read_from_file(path_str)
        .map_err(|e| format!("failed to read heif {}: {e}", path_str))?;
    
    let handle = ctx
        .primary_image_handle()
        .map_err(|e| format!("failed to get primary image: {e}"))?;

    let image = lib_heif
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| format!("failed to decode heif: {e}"))?;

    let width = image.width();
    let height = image.height();
    let planes = image.planes();
    let plane = planes
        .interleaved
        .ok_or_else(|| "heif interleaved plane missing".to_string())?;

    let rgb_data = plane.data;
    let mut rgba_data = Vec::with_capacity(width as usize * height as usize * 4);
    for chunk in rgb_data.chunks(3) {
        rgba_data.push(chunk[0]);
        rgba_data.push(chunk[1]);
        rgba_data.push(chunk[2]);
        rgba_data.push(255);
    }

    let dynamic = image::DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, rgba_data)
            .ok_or_else(|| "failed to create rgba image from heif data".to_string())?
    );
    let resized = resize_if_needed(dynamic, max_size);
    let final_rgba = resized.to_rgba8();
    let (f_w, f_h) = (final_rgba.width(), final_rgba.height());
    let data = base64::engine::general_purpose::STANDARD.encode(final_rgba.into_raw());

    Ok((
        vec![ImageFrame {
            width: f_w,
            height: f_h,
            delay_ms: 0,
            data,
        }],
        "heif".into(),
    ))
}

#[cfg(feature = "jxl")]
fn decode_jxl(_path: &Path, max_size: Option<u32>) -> Result<(Vec<ImageFrame>, String), String> {
    let path_str = _path.display();
    let image = JxlImage::builder()
        .open(_path)
        .map_err(|e| format!("failed to open jxl {path_str}: {e}"))?;

    let render = image
        .render_frame(0)
        .map_err(|e| format!("failed to render jxl: {e}"))?;

    let mut stream = render.stream();
    let channels = stream.channels();
    let width = stream.width();
    let height = stream.height();

    if channels < 3 {
        return Err(format!("unexpected channel count in jxl: {channels}"));
    }

    let samples = width as usize * height as usize * channels as usize;
    let mut buf = vec![0f32; samples];
    let written = stream.write_to_buffer(&mut buf);
    if written != samples {
        return Err(format!("jxl buffer write mismatch: expected {samples}, got {written}"));
    }

    let mut rgba_data = Vec::with_capacity(width as usize * height as usize * 4);
    for chunk in buf.chunks(channels as usize) {
        let r = chunk[0].clamp(0.0, 1.0);
        let g = chunk[1].clamp(0.0, 1.0);
        let b = chunk[2].clamp(0.0, 1.0);
        let a = if channels >= 4 { chunk[3].clamp(0.0, 1.0) } else { 1.0 };

        rgba_data.push((r * 255.0 + 0.5) as u8);
        rgba_data.push((g * 255.0 + 0.5) as u8);
        rgba_data.push((b * 255.0 + 0.5) as u8);
        rgba_data.push((a * 255.0 + 0.5) as u8);
    }

    let dynamic = image::DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, rgba_data)
            .ok_or_else(|| "failed to create rgba image from jxl data".to_string())?
    );
    let resized = resize_if_needed(dynamic, max_size);
    let final_rgba = resized.to_rgba8();
    let (f_w, f_h) = (final_rgba.width(), final_rgba.height());
    let data = base64::engine::general_purpose::STANDARD.encode(final_rgba.into_raw());

    Ok((
        vec![ImageFrame {
            width: f_w,
            height: f_h,
            delay_ms: 0,
            data,
        }],
        "jxl".into(),
    ))
}

#[cfg(feature = "raw")]
fn decode_raw(_path: &Path, max_size: Option<u32>) -> Result<(Vec<ImageFrame>, String), String> {
    let path_str = _path
        .to_str()
        .ok_or_else(|| "invalid raw path".to_string())?
        .to_string();

    let raw = decode_file(&path_str).map_err(|e| format!("failed to read raw {path_str}: {e}"))?;
    let samples_f32: Vec<f32> = match raw.data {
        RawImageData::Float(v) => v,
        RawImageData::Integer(v) => v.into_iter().map(|x| x as f32).collect(),
    };

    let width = raw.width as u32;
    let height = raw.height as u32;
    let pixels = (width as usize).saturating_mul(height as usize);

    match raw.cpp {
        3 => {
            if samples_f32.len() < pixels * 3 {
                return Err("raw buffer too small".into());
            }

            let gamma = 1.0 / 2.2;
            let mut rgba_data = vec![0u8; pixels * 4];
            samples_f32
                .par_chunks_exact(3)
                .zip(rgba_data.par_chunks_mut(4))
                .for_each(|(px, dst)| {
                    let r = px[0].powf(gamma).clamp(0.0, 1.0);
                    let g = px[1].powf(gamma).clamp(0.0, 1.0);
                    let b = px[2].powf(gamma).clamp(0.0, 1.0);
                    dst[0] = (r * 255.0 + 0.5) as u8;
                    dst[1] = (g * 255.0 + 0.5) as u8;
                    dst[2] = (b * 255.0 + 0.5) as u8;
                    dst[3] = 255u8;
                });

            let dynamic = image::DynamicImage::ImageRgba8(
                image::RgbaImage::from_raw(width, height, rgba_data)
                    .ok_or_else(|| "failed to create rgba image from raw data".to_string())?
            );
            let resized = resize_if_needed(dynamic, max_size);
            let final_rgba = resized.to_rgba8();
            let (f_w, f_h) = (final_rgba.width(), final_rgba.height());
            let data = base64::engine::general_purpose::STANDARD.encode(final_rgba.into_raw());

            Ok((
                vec![ImageFrame {
                    width: f_w,
                    height: f_h,
                    delay_ms: 0,
                    data,
                }],
                "raw".into(),
            ))
        }
        1 => {
            if samples_f32.len() < pixels {
                return Err("raw buffer too small".into());
            }

            let (min, max) = samples_f32
                .par_iter()
                .fold(
                    || (f32::MAX, f32::MIN),
                    |(min, max), &val| (min.min(val), max.max(val)),
                )
                .reduce(|| (f32::MAX, f32::MIN), |a, b| (a.0.min(b.0), a.1.max(b.1)));

            let range = if (max - min).abs() < f32::EPSILON {
                1.0
            } else {
                max - min
            };

            let gamma = 1.0 / 2.2;
            let mut rgba_data = vec![0u8; pixels * 4];
            samples_f32
                .par_iter()
                .zip(rgba_data.par_chunks_mut(4))
                .for_each(|(&val, dst)| {
                    let norm = ((val - min) / range).clamp(0.0, 1.0).powf(gamma);
                    let byte = (norm * 255.0 + 0.5) as u8;
                    dst[0] = byte;
                    dst[1] = byte;
                    dst[2] = byte;
                    dst[3] = 255u8;
                });

            let dynamic = image::DynamicImage::ImageRgba8(
                image::RgbaImage::from_raw(width, height, rgba_data)
                    .ok_or_else(|| "failed to create grayscale image from raw data".to_string())?
            );
            let resized = resize_if_needed(dynamic, max_size);
            let final_rgba = resized.to_rgba8();
            let (f_w, f_h) = (final_rgba.width(), final_rgba.height());
            let data = base64::engine::general_purpose::STANDARD.encode(final_rgba.into_raw());

            Ok((
                vec![ImageFrame {
                    width: f_w,
                    height: f_h,
                    delay_ms: 0,
                    data,
                }],
                "raw".into(),
            ))
        }
        other => Err(format!("unsupported RAW cpp={} (only mono or rgb supported)", other)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![open_image, get_directory_images, get_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
