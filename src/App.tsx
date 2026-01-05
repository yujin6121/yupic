import type { PointerEvent, WheelEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import "./App.css";

type Frame = {
  width: number;
  height: number;
  delay_ms: number;
  data: string;
  bitmap?: ImageBitmap;
};

type ImageResponse = {
  path: string;
  format: string;
  frames: Frame[];
};

type ViewState = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

type Viewport = {
  width: number;
  height: number;
};

type MetaEntry = {
  tag: string;
  value: string;
};

type Language = "ko" | "en";
type Theme = "dark" | "light";

type Settings = {
  maxResolution: number; // 0 means unlimited
  defaultResolution: number; // fallback when viewport not ready
  language: Language;
  theme: Theme;
  showInfoByDefault: boolean;
};

const TRANSLATIONS = {
  ko: {
    open: "이미지 열기",
    clear: "지우기",
    info: "정보",
    settings: "설정",
    ready: "준비됨",
    decoding: "디코딩 중...",
    metadataLoading: "메타데이터 로드 중...",
    noMetadata: "메타데이터 없음",
    path: "경로",
    format: "포맷",
    size: "크기",
    frames: "프레임",
    maxRes: "최대 해상도 제한",
    unlimited: "제한 없음",
    lang: "언어",
    close: "닫기",
    dropHint: "이미지를 드래그하거나 열기 버튼을 클릭하세요",
    theme: "테마",
    dark: "다크",
    light: "라이트",
    defaultInfo: "정보창 기본 활성화",
    defaultRes: "기본 해상도",
    on: "켜짐",
    off: "꺼짐",
    rotateLeft: "반시계 회전",
    rotateRight: "시계 회전",
    flipH: "좌우 반전",
    flipV: "상하 반전",
    fullscreen: "전체 화면",
    version: "버전",
    checkUpdates: "업데이트 확인",
    checking: "업데이트 확인 중...",
    upToDate: "최신 버전입니다",
    updateAvailable: "업데이트 이용 가능",
    download: "다운로드",
    releaseNotes: "릴리스 노트",
    updateError: "업데이트 확인 중 오류가 발생했습니다",
  },
  en: {
    open: "Open Image",
    clear: "Clear",
    info: "Info",
    settings: "Settings",
    ready: "Ready",
    decoding: "Decoding...",
    metadataLoading: "Loading metadata...",
    noMetadata: "No metadata",
    path: "Path",
    format: "Format",
    size: "Size",
    frames: "Frames",
    maxRes: "Max Resolution",
    unlimited: "Unlimited",
    lang: "Language",
    close: "Close",
    dropHint: "Drop an image or click Open",
    theme: "Theme",
    dark: "Dark",
    light: "Light",
    defaultInfo: "Show Info by Default",
    defaultRes: "Default Resolution",
    on: "On",
    off: "Off",
    rotateLeft: "Rotate Left",
    rotateRight: "Rotate Right",
    flipH: "Flip Horizontal",
    flipV: "Flip Vertical",
    fullscreen: "Fullscreen",
    version: "Version",
    checkUpdates: "Check for updates",
    checking: "Checking for updates...",
    upToDate: "Up to date",
    updateAvailable: "Update available",
    download: "Download",
    releaseNotes: "Release notes",
    updateError: "Failed to check updates",
  },
};

function decodeBase64(data: string) {
  try {
    const binary = atob(data);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i);
    }
    return buffer;
  } catch (e) {
    console.error("Base64 decode failed", e);
    return new Uint8Array(0);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseGpsCoord(coord: string, ref: string): number | null {
  // Parse EXIF GPS format like "37 deg 30' 15.5\"" or "37/1, 30/1, 1555/100"
  try {
    let degrees = 0, minutes = 0, seconds = 0;
    
    // Try parsing "deg ' \"" format
    const dmsMatch = coord.match(/([\d.]+)\s*(?:deg|°)?\s*([\d.]+)?\s*['′]?\s*([\d.]+)?\s*["\u2033]?/);
    if (dmsMatch) {
      degrees = parseFloat(dmsMatch[1]) || 0;
      minutes = parseFloat(dmsMatch[2]) || 0;
      seconds = parseFloat(dmsMatch[3]) || 0;
    } else {
      // Try parsing rational format "37/1, 30/1, 1555/100"
      const parts = coord.split(/[,\s]+/).map(p => {
        const [num, den] = p.split('/');
        return den ? parseFloat(num) / parseFloat(den) : parseFloat(num);
      }).filter(n => !isNaN(n));
      if (parts.length >= 1) degrees = parts[0];
      if (parts.length >= 2) minutes = parts[1];
      if (parts.length >= 3) seconds = parts[2];
    }
    
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (ref === 'S' || ref === 'W') decimal = -decimal;
    return decimal;
  } catch {
    return null;
  }
}

const WEB_FORMATS = new Set(["bmp", "jpg", "jpeg", "png", "webp", "svg", "ico", "avif"]);

function scaleToLimit(width: number, height: number, maxDim: number) {
  if (!maxDim || maxDim <= 0) return { width, height };
  const scale = Math.min(maxDim / width, maxDim / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}


function App() {
  const [image, setImage] = useState<ImageResponse | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem("spectra-settings");
    const defaults: Settings = { 
      maxResolution: 0, 
      defaultResolution: 1440,
      language: "ko", 
      theme: "dark", 
      showInfoByDefault: true 
    };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });

  const t = TRANSLATIONS[settings.language];
  const [status, setStatus] = useState("");
  const [view, setView] = useState<ViewState>({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imageCache = useRef<Map<string, ImageResponse>>(new Map());
  const [fitPending, setFitPending] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [sidebarVisible, setSidebarVisible] = useState(settings.showInfoByDefault);
  const [imageList, setImageList] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [metadata, setMetadata] = useState<MetaEntry[]>([]);
  const [metadataStatus, setMetadataStatus] = useState<string>("");
  const [canvasLoaded, setCanvasLoaded] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [showFullMeta, setShowFullMeta] = useState(false);

  // Updater state
  const [appVersionStr, setAppVersionStr] = useState<string>("?");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState<string>("");
  const [latestRelease, setLatestRelease] = useState<{
    tag: string;
    url?: string;
    notes?: string;
    html_url?: string;
  } | null>(null);

  useEffect(() => {
    getVersion()
      .then(v => setAppVersionStr(v))
      .catch(() => setAppVersionStr("?"));
  }, []);

  function compareVersions(a: string, b: string) {
    const na = (a || '').toString().replace(/^v/, "");
    const nb = (b || '').toString().replace(/^v/, "");
    const pa = na.split('.').map(s => parseInt(s, 10) || 0);
    const pb = nb.split('.').map(s => parseInt(s, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] || 0;
      const vb = pb[i] || 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateStatusText(t.checking);
    setLatestRelease(null);

    try {
      const resp = await fetch('https://api.github.com/repos/yujin6121/yupic/releases/latest');
      if (!resp.ok) throw new Error('release fetch failed');
      const rel = await resp.json();
      const tag = rel.tag_name || rel.name || '';
      const body = rel.body || '';
      const assets = rel.assets || [];

      // Determine platform and desired asset extension
      const platform = navigator.platform || '';
      let wantedExts: string[] = [];
      if (/Mac|iPhone|iPad|Darwin/.test(platform)) {
        wantedExts = ['dmg', 'pkg'];
      } else if (/Win/.test(platform)) {
        wantedExts = ['msi', 'exe', 'zip', 'nsis'];
      } else {
        wantedExts = ['AppImage', 'deb', 'tar.gz', 'zip'];
      }

      let downloadUrl: string | undefined;
      for (const a of assets) {
        const name: string = a.name || '';
        for (const ext of wantedExts) {
          if (name.toLowerCase().endsWith(ext.toLowerCase())) {
            downloadUrl = a.browser_download_url;
            break;
          }
        }
        if (downloadUrl) break;
      }

      // Fall back to html_url of release
      const htmlUrl = rel.html_url;

      setLatestRelease({ tag, url: downloadUrl, notes: body, html_url: htmlUrl });

      const cmp = compareVersions(appVersionStr, tag || '');
      if (!tag) {
        setUpdateStatusText(t.updateError);
      } else if (cmp < 0) {
        setUpdateStatusText(`${t.updateAvailable}: ${tag}`);
      } else {
        setUpdateStatusText(t.upToDate);
      }
    } catch (e) {
      console.warn('update check failed', e);
      setUpdateStatusText(t.updateError);
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersionStr, t.checking, t.updateAvailable, t.updateError, t.upToDate]);

  async function openUrl(url: string) {
    try {
      const modName = '@tauri-apps/api/shell';
      // Prevent Vite from trying to statically analyze this import
      // @ts-ignore
      const mod = await import(/* @vite-ignore */ (modName as any));
      if (mod) {
        const maybeOpen = (mod && (mod.open || mod.default?.open || mod.default)) as any;
        if (typeof maybeOpen === 'function') {
          maybeOpen(url);
          return;
        }
      }
    } catch (e) {
      // dynamic import failed, fall back to window.open
      console.warn('shell import failed, falling back to window.open', e);
    }

    try {
      window.open(url, '_blank', 'noopener');
    } catch { }
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<ImageResponse | null>(null);
  const prevMaxResRef = useRef<number>(settings.maxResolution);
  const panStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ distance: number; center: { x: number; y: number }; view: ViewState } | null>(null);
  const renderPending = useRef(false);

  const releaseImage = useCallback((img?: ImageResponse | null) => {
    if (!img) return;
    try {
      img.frames.forEach((f) => f.bitmap?.close?.());
    } catch (e) {
      console.warn("releaseImage failed", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("spectra-settings", JSON.stringify(settings));
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings]);

  useEffect(() => {
    imageRef.current = image;
  }, [image]);

  useEffect(() => () => {
    releaseImage(imageRef.current);
    imageCache.current.forEach((img) => releaseImage(img));
    imageCache.current.clear();
  }, [releaseImage]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewport({ width, height });
      }
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const currentFrame = useMemo(() => {
    if (!image || image.frames.length === 0) return null;
    return image.frames[frameIndex % image.frames.length];
  }, [frameIndex, image]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const source = sourceCanvasRef.current;
    if (!canvas || !source) return;

    const { width: vw, height: vh } = viewport;
    if (!vw || !vh) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    context.scale(dpr, dpr);

    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, vw, vh);

    context.save();
    context.translate(vw / 2 + view.offsetX, vh / 2 + view.offsetY);
    context.rotate((view.rotation * Math.PI) / 180);
    context.scale(view.flipX ? -1 : 1, view.flipY ? -1 : 1);

    const imgW = source.width * view.zoom;
    const imgH = source.height * view.zoom;

    context.imageSmoothingEnabled = view.zoom < 1;
    context.imageSmoothingQuality = isInteracting ? "low" : "high";
    context.drawImage(source, -imgW / 2, -imgH / 2, imgW, imgH);
    context.restore();
  }, [viewport, view, isInteracting]);

  const scheduleRender = useCallback(() => {
    if (renderPending.current) return;
    renderPending.current = true;
    requestAnimationFrame(() => {
      renderPending.current = false;
      render();
    });
  }, [render]);

  const applyFrame = useCallback(
    (frame: Frame) => {
      let source = sourceCanvasRef.current;
      if (!source) {
        source = document.createElement("canvas");
        sourceCanvasRef.current = source;
      }

      if (frame.bitmap) {
        source.width = frame.width;
        source.height = frame.height;
        const context = source.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, source.width, source.height);
        context.drawImage(frame.bitmap, 0, 0);
        scheduleRender();
        setTimeout(() => setCanvasLoaded(true), 10);
        return;
      }

      if (!frame.data) return;

      try {
        const buffer = decodeBase64(frame.data);
        if (buffer.length === 0) return;
        if (buffer.length < frame.width * frame.height * 4) {
          console.warn("Decoded buffer smaller than expected", buffer.length);
          return;
        }
        const imageData = new ImageData(new Uint8ClampedArray(buffer), frame.width, frame.height);
        
        source.width = frame.width;
        source.height = frame.height;
        const context = source.getContext("2d");
        if (!context) return;
        context.putImageData(imageData, 0, 0);
        
        scheduleRender();
        setTimeout(() => setCanvasLoaded(true), 10);
      } catch (e) {
        console.error("Failed to apply frame", e);
      }
    },
    [scheduleRender],
  );

  useEffect(() => {
    scheduleRender();
  }, [scheduleRender, view, viewport, isInteracting]);

  useEffect(() => {
    if (!currentFrame) return;
    applyFrame(currentFrame);
  }, [applyFrame, currentFrame]);

  useEffect(() => {
    if (!image || image.frames.length <= 1) return undefined;

    let cancelled = false;
    let timer: number | undefined;

    const tick = (nextIndex: number) => {
      if (cancelled) return;
      const nextFrame = image.frames[nextIndex];
      const delay = Math.max(10, nextFrame.delay_ms || 100);

      timer = window.setTimeout(() => {
        if (cancelled) return;
        setFrameIndex((prev) => (prev + 1) % image.frames.length);
        const upcoming = (nextIndex + 1) % image.frames.length;
        tick(upcoming);
      }, delay);
    };

    tick((frameIndex + 1) % image.frames.length);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [frameIndex, image]);

  const loadOptimizedImage = useCallback(async (path: string): Promise<ImageResponse> => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const computedMax = settings.maxResolution > 0
      ? settings.maxResolution
      : Math.max(viewport.width, viewport.height, 0);
    const safeMax = computedMax > 0 ? computedMax : settings.defaultResolution; // use setting when viewport not ready
    const maxSizeArg = safeMax > 0 ? safeMax : null;

    if (WEB_FORMATS.has(ext)) {
      try {
        const url = convertFileSrc(path);
        return await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            try {
              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const { width: targetW, height: targetH } = scaleToLimit(natW, natH, safeMax);
              const bitmap = targetW !== natW || targetH !== natH
                ? await createImageBitmap(img, { resizeWidth: targetW, resizeHeight: targetH, resizeQuality: "high" })
                : await createImageBitmap(img);

              resolve({
                path,
                format: ext,
                frames: [{
                  width: bitmap.width,
                  height: bitmap.height,
                  delay_ms: 0,
                  data: "",
                  bitmap: bitmap
                }]
              });
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = () => reject(new Error("Failed to load image via URL"));
          img.src = url;
        });
      } catch (e) {
        console.warn("Optimized load failed, falling back to slow load", e);
        return await invoke<ImageResponse>("open_image", { 
          path,
          maxSize: maxSizeArg
        });
      }
    } else {
      return await invoke<ImageResponse>("open_image", { 
        path,
        maxSize: maxSizeArg
      });
    }
  }, [settings.maxResolution, viewport]);

  const preloadImage = useCallback(async (path: string) => {
    if (imageCache.current.has(path)) return;
    try {
      const res = await loadOptimizedImage(path);
      // Aggressively limit cache size for low-end hardware
      if (imageCache.current.size > 2) {
        const firstKey = imageCache.current.keys().next().value;
        if (firstKey) {
          const cached = imageCache.current.get(firstKey);
          // Clean up bitmap resources
          if (cached?.frames) {
            cached.frames.forEach(f => f.bitmap?.close());
          }
          imageCache.current.delete(firstKey);
        }
      }
      imageCache.current.set(path, res);
    } catch (e) {
      console.error("Preload failed", e);
    }
  }, [loadOptimizedImage]);

  useEffect(() => {
    if (currentIndex >= 0 && imageList.length > 0) {
      const next = (currentIndex + 1) % imageList.length;
      const prev = (currentIndex - 1 + imageList.length) % imageList.length;
      preloadImage(imageList[next]);
      preloadImage(imageList[prev]);
    }
  }, [currentIndex, imageList, preloadImage]);

  const loadImage = useCallback(async (path: string) => {
    if (!path) return;
    setStatus(t.decoding);
    setMetadata([]);
    setMetadataStatus(t.metadataLoading);
    setCanvasLoaded(false);
    try {
      let payload: ImageResponse;
      if (imageCache.current.has(path)) {
        payload = imageCache.current.get(path)!;
      } else {
        payload = await loadOptimizedImage(path);
        imageCache.current.set(path, payload);
      }

      if (!payload || !payload.frames || payload.frames.length === 0) {
        throw new Error(settings.language === "ko" ? "이미지 프레임이 없습니다" : "No image frames");
      }
      setImage(payload);
      setFrameIndex(0);
      setFitPending(true);
      setStatus("");
      
      // Reset rotation/flip on new image
      setView(v => ({ ...v, rotation: 0, flipX: false, flipY: false }));

      // Load directory images for navigation
      try {
        const dirResult = await invoke<{ images: string[] }>("get_directory_images", { path });
        setImageList(dirResult.images);
        
        // Robust index finding (case-insensitive fallback)
        let idx = dirResult.images.indexOf(path);
        if (idx === -1) {
          idx = dirResult.images.findIndex(p => p.toLowerCase() === path.toLowerCase());
        }
        setCurrentIndex(idx);
      } catch (err) {
        console.warn("Failed to load directory images", err);
      }

      // Fetch metadata asynchronously
      invoke<{ path: string; entries: MetaEntry[] }>("get_metadata", { path })
        .then((meta) => {
          setMetadata(meta.entries || []);
          setMetadataStatus(meta.entries && meta.entries.length > 0 ? "" : "No metadata");
        })
        .catch((err) => {
          console.warn("metadata load failed", err);
          setMetadataStatus("Metadata load failed");
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open image";
      console.error("open_image failed", { path, error });
      setStatus(message);
      setMetadataStatus("Metadata load failed");
    }
  }, [settings.language, t.decoding, t.metadataLoading, loadOptimizedImage]);

  useEffect(() => {
    const prev = prevMaxResRef.current;
    if (prev !== settings.maxResolution) {
      imageCache.current.forEach((img) => releaseImage(img));
      imageCache.current.clear();
      if (imageRef.current) {
        loadImage(imageRef.current.path);
      }
      prevMaxResRef.current = settings.maxResolution;
    }
  }, [settings.maxResolution, loadImage, releaseImage]);

  const handlePick = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: [
            "bmp",
            "jpg",
            "jpeg",
            "gif",
            "png",
            "psd",
            "dds",
            "jxr",
            "webp",
            "j2k",
            "jp2",
            "tga",
            "tiff",
            "pcx",
            "pgm",
            "pnm",
            "ppm",
            "bpg",
            "dng",
            "cr2",
            "crw",
            "nef",
            "nrw",
            "orf",
            "rw2",
            "pef",
            "sr2",
            "arw",
            "raw",
            "raf",
            "avif",
            "jxl",
            "exr",
            "qoi",
            "ico",
            "svg",
            "heic",
          ],
        },
      ],
    });

    if (typeof selected === "string") {
      console.log("open dialog selected", selected);
      loadImage(selected);
    } else if (Array.isArray(selected)) {
      const arr = selected as string[];
      if (arr.length > 0 && typeof arr[0] === "string") {
        console.log("open dialog selected[0]", arr[0]);
        loadImage(arr[0]);
      }
    }
  }, [loadImage]);

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const full = !isFullscreen;
    await win.setFullscreen(full);
    setIsFullscreen(full);
  }, [isFullscreen]);

  useEffect(() => {
    let unlisten: any;
    async function setup() {
      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            loadImage(paths[0]);
          }
        }
      });
    }
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadImage]);

  const meta = useMemo(() => {
    if (!image || image.frames.length === 0) return null;
    const primary = image.frames[0];
    return {
      path: image.path,
      format: image.format,
      dimensions: `${primary.width} x ${primary.height}`,
      frames: image.frames.length,
    };
  }, [image]);

  const metaLookup = useMemo(() => {
    const map = new Map<string, string>();
    metadata.forEach((m) => {
      if (m.tag && typeof m.value === "string") {
        map.set(m.tag.toLowerCase(), m.value);
      }
    });
    return map;
  }, [metadata]);

  const metaSummary = useMemo(() => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = metaLookup.get(k.toLowerCase());
        if (v) return v;
      }
      return "";
    };

    // Parse GPS coordinates
    const latStr = get("gpslatitude");
    const latRef = get("gpslatituderef") || "N";
    const lonStr = get("gpslongitude");
    const lonRef = get("gpslongituderef") || "E";
    
    let gpsLat: number | null = null;
    let gpsLon: number | null = null;
    if (latStr && lonStr) {
      gpsLat = parseGpsCoord(latStr, latRef);
      gpsLon = parseGpsCoord(lonStr, lonRef);
    }

    return {
      camera: get("model", "camera"),
      lens: get("lensmodel", "lens"),
      aperture: get("fnumber", "aperture"),
      shutter: get("exposuretime"),
      iso: get("isospeedratings", "photographicsensitivity", "iso"),
      focal: get("focallength"),
      datetime: get("datetimeoriginal", "createdate", "datetime"),
      gpsLat,
      gpsLon,
    };
  }, [metaLookup]);

  const metaSummaryList = useMemo(() => {
    const list = [
      { label: "카메라", value: metaSummary.camera },
      { label: "렌즈", value: metaSummary.lens },
      { label: "조리개", value: metaSummary.aperture },
      { label: "셔터", value: metaSummary.shutter },
      { label: "ISO", value: metaSummary.iso },
      { label: "초점거리", value: metaSummary.focal },
      { label: "촬영일시", value: metaSummary.datetime },
    ].filter((row) => !!row.value);
    
    return list;
  }, [metaSummary]);

  const gpsUrl = useMemo(() => {
    if (metaSummary.gpsLat != null && metaSummary.gpsLon != null) {
      const lat = metaSummary.gpsLat.toFixed(6);
      const lon = metaSummary.gpsLon.toFixed(6);
      return `https://www.google.com/maps?q=${lat},${lon}`;
    }
    return null;
  }, [metaSummary.gpsLat, metaSummary.gpsLon]);

  const fitToScreen = useCallback(() => {
    if (!sourceCanvasRef.current) return;
    const { width: vw, height: vh } = viewport;
    const { width: iw, height: ih } = sourceCanvasRef.current;
    
    const isRotated = view.rotation % 180 !== 0;
    const effectiveW = isRotated ? ih : iw;
    const effectiveH = isRotated ? iw : ih;

    if (!vw || !vh || !effectiveW || !effectiveH) return;

    const fit = Math.min(vw / effectiveW, vh / effectiveH);
    const zoom = Number.isFinite(fit) && fit > 0 ? Math.min(fit, 1) : 1;
    setView((v) => ({ ...v, zoom, offsetX: 0, offsetY: 0 }));
  }, [viewport, view.rotation]);

  useEffect(() => {
    if (!fitPending || !image) return;
    fitToScreen();
    setFitPending(false);
  }, [fitPending, image, fitToScreen]);

  const zoomFromView = useCallback(
    (base: ViewState, cx: number, cy: number, factor: number): ViewState | null => {
      const source = sourceCanvasRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) return null;
      const rect = canvas.getBoundingClientRect();

      const nextZoom = clamp(base.zoom * factor, 0.05, 20);
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const modelX = (cx - base.offsetX - centerX + (source.width * base.zoom) / 2) / base.zoom;
      const modelY = (cy - base.offsetY - centerY + (source.height * base.zoom) / 2) / base.zoom;

      const nextOffsetX = cx - centerX - modelX * nextZoom + (source.width * nextZoom) / 2;
      const nextOffsetY = cy - centerY - modelY * nextZoom + (source.height * nextZoom) / 2;
      return { ...base, zoom: nextZoom, offsetX: nextOffsetX, offsetY: nextOffsetY };
    },
    [],
  );

  const zoomStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setView((prev) => zoomFromView(prev, cx, cy, factor) ?? prev);
    },
    [zoomFromView],
  );

  const handleZoomIn = useCallback(() => zoomStep(1.1), [zoomStep]);
  const handleZoomOut = useCallback(() => zoomStep(0.9), [zoomStep]);
  const handleReset = useCallback(() => setView(v => ({ ...v, zoom: 1, offsetX: 0, offsetY: 0 })), []);
  const handleFit = useCallback(() => {
    fitToScreen();
  }, [fitToScreen]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!image) return;
      const source = sourceCanvasRef.current;
      const canvas = canvasRef.current;
      if (!source || !canvas) return;

      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      setView((prev) => zoomFromView(prev, mx, my, factor) ?? prev);
    },
    [image, zoomFromView],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!image) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      setIsInteracting(true);
      canvas.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.current.size === 1) {
        setPanning(true);
        panStart.current = { x: event.clientX, y: event.clientY };
        offsetStart.current = { x: view.offsetX, y: view.offsetY };
      } else if (pointers.current.size === 2) {
        const pts = Array.from(pointers.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        pinchStart.current = { distance: dist, center: { x: cx, y: cy }, view };
        setPanning(false);
      }
    },
    [image, view],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.current.size === 2 && pinchStart.current) {
        const pts = Array.from(pointers.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;

        const factor = dist / Math.max(1.0, pinchStart.current.distance);
        const baseView = pinchStart.current.view;
        const next = zoomFromView(baseView, cx, cy, factor);
        if (next) setView(next);
      } else if (panning) {
        setView((prev) => ({
          ...prev,
          offsetX: offsetStart.current.x + (event.clientX - panStart.current.x),
          offsetY: offsetStart.current.y + (event.clientY - panStart.current.y),
        }));
      }
    },
    [panning, zoomFromView],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      pointers.current.delete(event.pointerId);
      pinchStart.current = null;

      if (pointers.current.size === 0) {
        setPanning(false);
        setIsInteracting(false);
      }

      canvasRef.current?.releasePointerCapture(event.pointerId);
    },
    [],
  );

  const navigateImage = useCallback(
    (direction: number) => {
      if (imageList.length === 0 || currentIndex < 0) return;
      let nextIndex = currentIndex + direction;
      
      // Wrap around
      if (nextIndex < 0) nextIndex = imageList.length - 1;
      if (nextIndex >= imageList.length) nextIndex = 0;
      
      loadImage(imageList[nextIndex]);
    },
    [imageList, currentIndex, loadImage],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!image) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateImage(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateImage(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, navigateImage]);

  return (
    <div className="shell" onMouseMove={(e) => {
      if (!image) return;
      setShowHeader(e.clientY < 64);
    }}>
      <header
        className="toolbar"
        style={image ? {
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          opacity: showHeader ? 1 : 0,
          pointerEvents: showHeader ? "auto" : "none",
          transition: "opacity 0.2s ease"
        } : undefined}
      >
        <div className="brand">yupic</div>
        <div className="actions">
          <button onClick={handlePick}>{t.open}</button>
          <div className="divider" />
          <button onClick={() => setSettingsVisible((prev) => !prev)}>
            {t.settings}
          </button>
          <span className="status">{status}</span>
        </div>
      </header>

      <main className="content">
        <section
          className="stage"
          ref={stageRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {!image && <div className="drop-hint">{t.dropHint}</div>}
          <canvas ref={canvasRef} className={canvasLoaded ? "loaded" : ""} />
          
          {image && (
            <div 
              className="floating-controls"
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="control-group">
                <button onClick={handleZoomOut}>-</button>
                <button onClick={handleZoomIn}>+</button>
              </div>
              <div className="divider" />
              <div className="control-group">
                <button onClick={handleFit}>Fit</button>
                <button onClick={handleReset}>1:1</button>
              </div>
              <div className="divider" />
              <div className="control-group">
                <button onClick={() => setView(v => ({ ...v, rotation: (v.rotation - 90) % 360 }))} title={t.rotateLeft}>↺</button>
                <button onClick={() => setView(v => ({ ...v, rotation: (v.rotation + 90) % 360 }))} title={t.rotateRight}>↻</button>
              </div>
              <div className="divider" />
              <div className="control-group">
                <button onClick={() => setView(v => ({ ...v, flipX: !v.flipX }))} title={t.flipH}>↔</button>
                <button onClick={() => setView(v => ({ ...v, flipY: !v.flipY }))} title={t.flipV}>↕</button>
              </div>
              <div className="divider" />
              <button onClick={toggleFullscreen} title={isFullscreen ? t.fullscreen : t.fullscreen}>
                ⛶
              </button>
              <div className="divider" />
              <button onClick={() => setSidebarVisible((prev) => !prev)}>
                {t.info}
              </button>
            </div>
          )}
        </section>

        <aside className={`sidebar ${sidebarVisible ? "" : "hidden"}`}>
          <div className="panel-title">{t.info}</div>
          {meta ? (
            <dl>
              <div>
                <dt>{t.path}</dt>
                <dd>{meta.path}</dd>
              </div>
              <div>
                <dt>{t.format}</dt>
                <dd>{meta.format}</dd>
              </div>
              <div>
                <dt>{t.size}</dt>
                <dd>{meta.dimensions}</dd>
              </div>
              <div>
                <dt>{t.frames}</dt>
                <dd>{meta.frames}</dd>
              </div>
            </dl>
          ) : (
            <p className="placeholder">{t.noMetadata}</p>
          )}
          <div className="panel-title" style={{ marginTop: 12 }}>
            Metadata
          </div>
          {metadataStatus && <p className="placeholder">{metadataStatus}</p>}
          {!metadataStatus && metadata.length === 0 && <p className="placeholder">{t.noMetadata}</p>}
          {metaSummaryList.length > 0 && (
            <div className="meta-list" style={{ marginBottom: 8 }}>
              {metaSummaryList.map((row, idx) => (
                <div key={`summary-${idx}`} className="meta-row">
                  <span className="meta-tag">{row.label}</span>
                  <span className="meta-val">{row.value}</span>
                </div>
              ))}
              {gpsUrl && (
                <div className="meta-row">
                  <span className="meta-tag">위치</span>
                  <a 
                    href={gpsUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="meta-val"
                    style={{ color: "#60a5fa", textDecoration: "underline", cursor: "pointer" }}
                  >
                    지도에서 보기 📍
                  </a>
                </div>
              )}
            </div>
          )}
          {metadata.length > 0 && (
            <>
              <button 
                className="meta-toggle" 
                onClick={() => setShowFullMeta(prev => !prev)}
                style={{ 
                  background: "none", 
                  border: "none", 
                  color: "#60a5fa", 
                  cursor: "pointer", 
                  padding: "4px 0",
                  fontSize: "12px",
                  textAlign: "left",
                  width: "100%"
                }}
              >
                {showFullMeta ? "▼ 전체 메타데이터 접기" : "▶ 전체 메타데이터 보기"} ({metadata.length})
              </button>
              {showFullMeta && (
                <div className="meta-list">
                  {metadata.map((m, idx) => (
                    <div key={`${m.tag}-${idx}`} className="meta-row">
                      <span className="meta-tag">{m.tag}</span>
                      <span className="meta-val">{m.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>

        <aside className={`sidebar settings-sidebar ${settingsVisible ? "" : "hidden"}`}>
          <div className="panel-title">{t.settings}</div>
          
          <div className="settings-group">
            <label>{t.theme}</label>
            <div className="lang-toggle">
              <button 
                className={settings.theme === "dark" ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, theme: "dark" }))}
              >
                {t.dark}
              </button>
              <button 
                className={settings.theme === "light" ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, theme: "light" }))}
              >
                {t.light}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label>{t.lang}</label>
            <div className="lang-toggle">
              <button 
                className={settings.language === "ko" ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, language: "ko" }))}
              >
                한국어
              </button>
              <button 
                className={settings.language === "en" ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, language: "en" }))}
              >
                English
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label>{t.maxRes}</label>
            <select 
              value={settings.maxResolution} 
              onChange={(e) => setSettings(s => ({ ...s, maxResolution: Number(e.target.value) }))}
            >
              <option value={0}>{t.unlimited}</option>
              <option value={1080}>1080p (1920x1080)</option>
              <option value={2160}>4K (3840x2160)</option>
              <option value={4320}>8K (7680x4320)</option>
            </select>
          </div>

          <div className="settings-group">
            <label>{t.defaultRes}</label>
            <select 
              value={settings.defaultResolution} 
              onChange={(e) => setSettings(s => ({ ...s, defaultResolution: Number(e.target.value) }))}
            >
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
              <option value={1440}>1440p</option>
              <option value={2160}>4K</option>
            </select>
          </div>

          <div className="settings-group">
            <label>{t.defaultInfo}</label>
            <div className="lang-toggle">
              <button 
                className={settings.showInfoByDefault ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, showInfoByDefault: true }))}
              >
                {t.on}
              </button>
              <button 
                className={!settings.showInfoByDefault ? "active" : ""} 
                onClick={() => setSettings(s => ({ ...s, showInfoByDefault: false }))}
              >
                {t.off}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label>{t.version}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: 'column' }}>
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><strong>{appVersionStr}</strong></div>
                <button onClick={checkForUpdates} disabled={checkingUpdate} style={{ whiteSpace: 'nowrap' }}>{checkingUpdate ? t.checking : t.checkUpdates}</button>
              </div>
              <div style={{ width: '100%', marginTop: 8 }}>
                {updateStatusText && <div style={{ fontSize: 13 }}>{updateStatusText}</div>}
                {latestRelease && latestRelease.url && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button onClick={() => openUrl(latestRelease.url!)}>{t.download}</button>
                    {latestRelease.html_url && <button onClick={() => openUrl(latestRelease.html_url!)}>{t.releaseNotes}</button>}
                  </div>
                )}
                {latestRelease && !latestRelease.url && latestRelease.html_url && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => openUrl(latestRelease.html_url!)}>{t.releaseNotes}</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <button className="full-width" onClick={() => setSettingsVisible(false)}>{t.close}</button>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
