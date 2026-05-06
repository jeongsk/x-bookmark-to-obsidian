#!/usr/bin/env python3
"""
Native messaging host for the X bookmark -> Obsidian workflow.

Actions:
  - ping: health check
  - pick_folder: open a folder picker on macOS
  - write_file: write an arbitrary file under the user's home directory
  - save_x_bookmark: fetch a tweet via local x-fetcher and save markdown note
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


HOME = Path.home()
DEFAULT_OUTPUT_DIR = ""
LOG_DIR = HOME / "Library" / "Logs" / "x-bookmark-to-obsidian"
LOG_FILE = LOG_DIR / "native-host.log"
X_FETCHER_PATH = Path(__file__).with_name("fetch_tweet.py")
MAX_MESSAGE_BYTES = 1024 * 1024

# In-memory URL index for O(1) duplicate detection
_url_index: Dict[str, Path] = {}
_index_loaded: bool = False
_URL_INDEX_MAX_SIZE = 10000


def read_message() -> Optional[Dict[str, Any]]:
    try:
        raw_length = sys.stdin.buffer.read(4)
        if len(raw_length) < 4:
            return None
        length = struct.unpack("<I", raw_length)[0]
        if length > MAX_MESSAGE_BYTES:
            log_event("read_message_too_large", length=length)
            return None
        raw = sys.stdin.buffer.read(length)
        message = json.loads(raw.decode("utf-8"))
        log_event("message_received", action=message.get("action"), length=length)
        return message
    except Exception as exc:
        log_event("read_message_failed", error=str(exc))
        raise


def send_message(msg: Dict[str, Any]) -> None:
    encoded = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def log_event(event: str, **fields: Any) -> None:
    try:
      LOG_DIR.mkdir(parents=True, exist_ok=True)
      payload = {
          "time": datetime.now().isoformat(timespec="seconds"),
          "event": event,
          **fields,
      }
      with LOG_FILE.open("a", encoding="utf-8") as handle:
          handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
      pass


def validate_path(file_path: str) -> Tuple[Optional[Path], Optional[str]]:
    if "\x00" in file_path:
        return None, "path contains null byte"
    parts = file_path.replace("\\", "/").split("/")
    if ".." in parts:
        return None, "path contains .."

    resolved = Path(os.path.realpath(os.path.expanduser(file_path)))
    if not str(resolved).startswith(str(HOME)):
        return None, "path is outside home directory"
    return resolved, None


def validate_directory_path(dir_path: str) -> Tuple[Optional[Path], Optional[str]]:
    if "\x00" in dir_path:
        return None, "path contains null byte"
    expanded = os.path.expanduser(dir_path)
    if not os.path.isabs(expanded):
        return None, "output_dir must be an absolute path"
    resolved = Path(os.path.realpath(expanded))
    return resolved, None


def pick_folder() -> Dict[str, Any]:
    try:
        proc = subprocess.run(
            ["osascript", "-e", 'POSIX path of (choose folder with prompt "Obsidian 저장 디렉토리 선택")'],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            path = proc.stdout.strip().rstrip("/")
            return {"success": True, "path": path, "name": os.path.basename(path)}
        return {"success": False, "error": "cancelled"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "timeout"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def write_file(file_path: str, content: str, overwrite: bool = False) -> Dict[str, Any]:
    try:
        resolved, err = validate_path(file_path)
        if err:
            return {"success": False, "error": err}

        assert resolved is not None
        resolved.parent.mkdir(parents=True, exist_ok=True)

        final_path = resolved
        if not overwrite:
            counter = 0
            while final_path.exists():
                counter += 1
                final_path = resolved.with_name(f"{resolved.stem} ({counter}){resolved.suffix}")

        final_path.write_text(content, encoding="utf-8")
        return {"success": True, "path": str(final_path)}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def sanitize_filename(name: str, max_len: int = 80) -> str:
    value = re.sub(r"[\x00-\x1f\x7f]", "", name or "")
    value = re.sub(r'[\\/:*?"<>|]', " ", value)
    value = re.sub(r"\s+", " ", value).strip().strip(".")
    return (value or "untitled")[:max_len].rstrip()


def normalize_url(url: str) -> str:
    match = re.search(r"https://(?:x|twitter)\.com/([^/]+)/status/(\d+)", url or "")
    if match:
        return f"https://x.com/{match.group(1)}/status/{match.group(2)}"
    threads_match = re.search(r"(https://www\.threads\.net/@[\w.]+/post/[A-Za-z0-9_-]+)", url or "")
    if threads_match:
        u = threads_match.group(1)
        return u.split("?")[0]
    return url or ""


def _load_url_index(output_dir: Path) -> None:
    """Build the URL -> note path index by scanning the output directory once."""
    global _url_index, _index_loaded
    if _index_loaded:
        return
    _url_index.clear()
    if not output_dir.exists():
        _index_loaded = True
        return
    for path in output_dir.glob("*.md"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        frontmatter = text[:2000]
        m = re.search(r"^url:\s*[\"']?(https?://[^\"'>\s]+)[\"']?\s*$", frontmatter, flags=re.MULTILINE)
        if m:
            normalized = normalize_url(m.group(1))
            if normalized:
                _url_index[normalized] = path
    _index_loaded = True
    entry_count = len(_url_index)
    log_event("url_index_loaded", count=entry_count, dir=str(output_dir))
    if entry_count >= _URL_INDEX_MAX_SIZE:
        log_event("url_index_at_capacity", count=entry_count, max=_URL_INDEX_MAX_SIZE)


def _index_note(url: str, path: Path) -> None:
    """Incrementally add a saved note to the URL index (LRU-bounded)."""
    normalized = normalize_url(url)
    if len(_url_index) >= _URL_INDEX_MAX_SIZE and normalized not in _url_index:
        oldest = next(iter(_url_index))
        del _url_index[oldest]
    _url_index[normalized] = path


def detect_existing_note(url: str, output_dir: Path) -> Optional[Path]:
    _load_url_index(output_dir)
    normalized = normalize_url(url)
    return _url_index.get(normalized)


def format_author(author_name: str, handle: str) -> str:
    clean_name = (author_name or "").strip()
    clean_handle = (handle or "").strip().lstrip("@")
    if clean_name and clean_handle:
        return f"[{clean_name} @{clean_handle}]"
    if clean_handle:
        return f"[@{clean_handle}]"
    if clean_name:
        return f"[{clean_name}]"
    return "[]"


def parse_created_date(value: str) -> Tuple[str, str]:
    if not value:
        today = datetime.now().strftime("%Y-%m-%d")
        return today, today
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local_dt = dt.astimezone()
        return local_dt.strftime("%Y-%m-%d"), local_dt.strftime("%Y-%m-%d")
    except Exception:
        date_only = value[:10] if len(value) >= 10 else datetime.now().strftime("%Y-%m-%d")
        return date_only, datetime.now().strftime("%Y-%m-%d")


def build_title(fetch_data: Optional[Dict[str, Any]], payload: Dict[str, Any]) -> str:
    tweet = (fetch_data or {}).get("tweet", {})
    title_source = ""
    if tweet.get("is_article") and tweet.get("article", {}).get("title"):
        title_source = tweet["article"]["title"]
    else:
        title_source = tweet.get("text") or payload.get("text") or payload.get("tweet_id") or "x-bookmark"
    title_source = title_source.splitlines()[0]
    return sanitize_filename(title_source, max_len=60)


def _parse_tags(raw: str) -> list[str]:
    """Parse comma-separated tags into a cleaned list."""
    if not raw or not raw.strip():
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _apply_filename_template(payload: Dict[str, Any], fetch_data: Optional[Dict[str, Any]], title: str) -> str:
    template = (payload.get("filename_template") or "{title}").strip()
    tweet = (fetch_data or {}).get("tweet", {})
    captured_at = payload.get("captured_at", "")
    try:
        date_str = captured_at[:10] if len(captured_at) >= 10 else datetime.now().strftime("%Y-%m-%d")
    except Exception:
        date_str = datetime.now().strftime("%Y-%m-%d")

    author = (
        (tweet.get("screen_name") or fetch_data.get("username") or payload.get("author_handle", "")).strip().lstrip("@")
    )
    tweet_id = payload.get("tweet_id", payload.get("id", ""))
    source = payload.get("source", "x-bookmark")

    result = template
    result = result.replace("{title}", title)
    result = result.replace("{date}", date_str)
    result = result.replace("{author}", author)
    result = result.replace("{id}", str(tweet_id))
    result = result.replace("{source}", str(source))

    return result or title


def build_markdown(fetch_data: Optional[Dict[str, Any]], payload: Dict[str, Any], fetch_error: str = "") -> Tuple[str, str]:
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    normalized_url = normalize_url(payload.get("url", ""))
    tweet = (fetch_data or {}).get("tweet", {})
    title = build_title(fetch_data, payload)

    if fetch_data and not fetch_error:
        published, modified = parse_created_date(tweet.get("created_at", ""))
        author_name = tweet.get("author") or payload.get("author_name", "")
        handle = tweet.get("screen_name") or fetch_data.get("username") or payload.get("author_handle", "")
        text = tweet.get("article", {}).get("full_text") or tweet.get("text") or payload.get("text") or ""
        metrics = {
            "좋아요": tweet.get("likes"),
            "리트윗": tweet.get("retweets"),
            "조회": tweet.get("views"),
            "답글": tweet.get("replies_count"),
            "북마크": tweet.get("bookmarks"),
        }
        media_lines = extract_media_lines(tweet.get("media", []) or [])
    else:
        published = payload.get("published_at", "")[:10] or today
        modified = today
        author_name = payload.get("author_name", "")
        handle = payload.get("author_handle", "")
        text = payload.get("text", "") or "가져오기 실패, 원본 링크를 보존합니다."
        metrics = {
            "좋아요": (payload.get("metrics") or {}).get("likes"),
            "리트윗": (payload.get("metrics") or {}).get("reposts"),
            "조회": (payload.get("metrics") or {}).get("views"),
            "답글": (payload.get("metrics") or {}).get("replies"),
        }
        media_lines = []

    info_parts = [f"{k} {v}" for k, v in metrics.items() if v not in (None, "", "0")]

    content_hash = str(payload.get("content_hash", ""))
    default_tags = _parse_tags(payload.get("default_tags", ""))

    lines = [
        "---",
        "aliases: []",
        f"tags: [{', '.join(default_tags)}]" if default_tags else "tags: []",
        "up:",
        f"url: {normalized_url}",
        f"author: {format_author(author_name, handle)}",
        f"published: {published}",
        "source: X (Twitter)",
        "fetch_method: x_bookmark_helper",
        f"content_hash: {content_hash}",
        f"생성 시간: {today}",
        f"수정 시간: {modified}",
        "---",
        f"# {title}",
        "",
        "> [!INFO] 게시글 정보",
        f"> - 저자: {author_name or '@' + handle if handle else '알 수 없는 저자'}",
        f"> - 링크: {normalized_url}",
        f"> - 북마크 시간: {today}",
    ]

    if info_parts:
        lines.append("> - 인게이지먼트: " + " · ".join(info_parts))

    if fetch_error:
        lines.extend([
            "> [!WARNING] 자동 수집 폴백",
            f"> - 사유: {fetch_error}",
            "> - 처리 방식: 자리표시자 노트를 먼저 저장했습니다. 나중에 Web Clipper Quick clip으로 보완할 수 있습니다.",
        ])

    lines.extend(["", "## 본문", "", text.strip() or "(본문 없음)"])

    if media_lines:
        lines.extend(["", "## 미디어", ""])
        lines.extend(media_lines)

    return "\n".join(lines).strip() + "\n", title


def extract_media_lines(media_items: Any) -> list[str]:
    lines: list[str] = []
    if isinstance(media_items, dict):
        for image in media_items.get("images", []) or []:
            if isinstance(image, dict) and image.get("url"):
                lines.append(f"![]({image['url']})")

        for video in media_items.get("videos", []) or []:
            if not isinstance(video, dict):
                continue
            thumbnail = video.get("thumbnail")
            if thumbnail:
                lines.append(f"![]({thumbnail})")
            video_url = video.get("url")
            if video_url:
                lines.append(f"[비디오 링크]({video_url})")
        return dedupe_lines(lines)

    if not isinstance(media_items, list):
        return lines

    for item in media_items:
        media_url = ""
        if isinstance(item, str):
            media_url = item
        elif isinstance(item, dict):
            media_url = (
                item.get("url")
                or item.get("media_url")
                or item.get("expanded_url")
                or item.get("original")
            )
        if media_url:
            lines.append(f"![]({media_url})")
    return dedupe_lines(lines)


def _download_media_files(markdown: str, output_dir: Path, note_stem: str) -> str:
    """Download referenced media files and replace remote URLs with local paths."""
    media_dir = output_dir / f"{note_stem}_media"
    img_pattern = re.compile(r"!\[\]\((https?://[^)]+)\)")

    updated = markdown
    for match in img_pattern.finditer(markdown):
        url = match.group(1)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "X-Bookmark-To-Obsidian/2.5"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
        except Exception:
            log_event("media_download_failed", url=url)
            continue

        ext = ".jpg"
        content_type = ""
        if hasattr(resp, "info"):
            content_type = resp.info().get_content_type()
        if "png" in content_type:
            ext = ".png"
        elif "gif" in content_type:
            ext = ".gif"
        elif "webp" in content_type:
            ext = ".webp"
        elif "mp4" in content_type:
            ext = ".mp4"

        name = hashlib.sha256(url.encode()).hexdigest()[:12] + ext
        try:
            media_dir.mkdir(parents=True, exist_ok=True)
            filepath = media_dir / name
            filepath.write_bytes(data)
            relative_path = f"{media_dir.name}/{name}"
            updated = updated.replace(url, relative_path)
            log_event("media_downloaded", url=url, path=str(filepath))
        except Exception as exc:
            log_event("media_save_failed", url=url, error=str(exc))

    return updated


def dedupe_lines(lines: list[str]) -> list[str]:
    seen = set()
    result = []
    for line in lines:
        if line in seen:
            continue
        seen.add(line)
        result.append(line)
    return result


def run_x_fetcher(url: str) -> Tuple[Optional[Dict[str, Any]], str]:
    if not X_FETCHER_PATH.exists():
        return None, f"x-fetcher not found: {X_FETCHER_PATH}"

    cmd = ["python3", str(X_FETCHER_PATH), "--url", url]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    except Exception as exc:
        return None, str(exc)

    stdout = (proc.stdout or "").strip()
    if not stdout:
        return None, proc.stderr.strip() or "x-fetcher returned empty output"

    try:
        data = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError as exc:
        return None, f"invalid x-fetcher json: {exc}"

    if data.get("error"):
        return None, str(data["error"])
    return data, ""


def save_x_bookmark(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = normalize_url(str(payload.get("url", "")))
    output_dir_raw = str(payload.get("output_dir", "") or DEFAULT_OUTPUT_DIR).strip()
    if not output_dir_raw:
        return {"success": False, "error": "Obsidian 저장 디렉토리를 먼저 설정하세요."}
    output_dir, dir_err = validate_directory_path(output_dir_raw)
    if dir_err:
        return {"success": False, "error": dir_err}
    assert output_dir is not None
    log_event("save_requested", url=url, tweet_id=payload.get("tweet_id", ""))
    if not re.match(r"^https://x\.com/[^/]+/status/\d+$", url):
        return {"success": False, "error": "invalid tweet url"}

    content_hash = str(payload.get("content_hash", ""))
    existing = detect_existing_note(url, output_dir)
    if existing:
        existing_hash = _read_content_hash(existing)
        if content_hash and existing_hash and content_hash == existing_hash:
            log_event("deduped", url=url, path=str(existing))
            return {
                "success": True,
                "path": str(existing),
                "deduped": True,
                "fallback_used": False,
                "fetch_status": "existing",
                "note_title": existing.stem,
            }

        if content_hash and existing_hash and content_hash != existing_hash:
            log_event("content_changed", url=url, path=str(existing), old_hash=existing_hash, new_hash=content_hash)
            return _update_existing_note(existing, payload, url)

        log_event("deduped", url=url, path=str(existing))
        return {
            "success": True,
            "path": str(existing),
            "deduped": True,
            "fallback_used": False,
            "fetch_status": "existing",
            "note_title": existing.stem,
        }

    fetch_data, fetch_error = run_x_fetcher(url)
    markdown, title = build_markdown(fetch_data, payload, fetch_error=fetch_error)
    filename = _apply_filename_template(payload, fetch_data, title) + ".md"
    filename = sanitize_filename(filename, max_len=120)
    output_path = output_dir / filename

    if payload.get("download_media"):
        note_stem = output_path.stem
        markdown = _download_media_files(markdown, output_dir, note_stem)

    result = write_file(str(output_path), markdown, overwrite=False)

    if not result.get("success"):
        log_event("write_failed", url=url, error=result.get("error", "unknown"))
        return result

    log_event(
        "saved",
        url=url,
        path=result["path"],
        fallback_used=bool(fetch_error),
        fetch_status="fallback" if fetch_error else "success",
    )
    _index_note(url, output_path)
    return {
        "success": True,
        "path": result["path"],
        "deduped": False,
        "fallback_used": bool(fetch_error),
        "fetch_status": "fallback" if fetch_error else "success",
        "note_title": title,
    }


def _read_content_hash(path: Path) -> str:
    """Read the content_hash from a note's frontmatter."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
    m = re.search(r"^content_hash:\s*[\"']?([a-f0-9]+)[\"']?\s*$", text[:2000], flags=re.MULTILINE)
    return m.group(1) if m else ""


def _update_existing_note(existing_path: Path, payload: Dict[str, Any], url: str) -> Dict[str, Any]:
    """Update an existing note when content has changed."""
    fetch_data, fetch_error = run_x_fetcher(url)
    markdown, title = build_markdown(fetch_data, payload, fetch_error=fetch_error)

    if payload.get("download_media"):
        note_stem = existing_path.stem
        markdown = _download_media_files(markdown, existing_path.parent, note_stem)

    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        text = existing_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        text = ""

    updated = re.sub(
        r"^updated_at:.*$",
        f"updated_at: \"{now}\"",
        text,
        flags=re.MULTILINE,
    )
    if "updated_at:" not in updated:
        updated = re.sub(
            r"(---\n)",
            f"\\1updated_at: \"{now}\"\n",
            updated,
            count=1,
        )

    existing_path.write_text(markdown, encoding="utf-8")
    log_event("updated", url=url, path=str(existing_path))
    return {
        "success": True,
        "path": str(existing_path),
        "deduped": False,
        "fallback_used": bool(fetch_error),
        "fetch_status": "updated",
        "note_title": title,
    }


def save_threads_bookmark(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = normalize_url(str(payload.get("url", "")))
    output_dir_raw = str(payload.get("output_dir", "") or DEFAULT_OUTPUT_DIR).strip()
    if not output_dir_raw:
        return {"success": False, "error": "Obsidian 저장 디렉토리를 먼저 설정하세요."}
    output_dir, dir_err = validate_directory_path(output_dir_raw)
    if dir_err:
        return {"success": False, "error": dir_err}
    assert output_dir is not None
    log_event("threads_save_requested", url=url, post_id=payload.get("tweet_id", ""))

    if not re.match(r"^https://www\.threads\.net/@[\w.]+/post/[A-Za-z0-9_-]+$", url):
        return {"success": False, "error": "invalid threads url"}

    content_hash = str(payload.get("content_hash", ""))
    existing = detect_existing_note(url, output_dir)
    if existing:
        existing_hash = _read_content_hash(existing)
        if content_hash and existing_hash and content_hash == existing_hash:
            log_event("threads_deduped", url=url, path=str(existing))
            return {
                "success": True,
                "path": str(existing),
                "deduped": True,
                "note_title": existing.stem,
            }

        if content_hash and existing_hash and content_hash != existing_hash:
            log_event("threads_content_changed", url=url, path=str(existing))
            return _update_threads_note(existing, payload, url)

        log_event("threads_deduped", url=url, path=str(existing))
        return {
            "success": True,
            "path": str(existing),
            "deduped": True,
            "note_title": existing.stem,
        }

    markdown, title = build_threads_markdown(payload)
    filename = _apply_filename_template(payload, None, title) + ".md"
    filename = sanitize_filename(filename, max_len=120)
    output_path = output_dir / filename

    if payload.get("download_media"):
        note_stem = output_path.stem
        markdown = _download_media_files(markdown, output_dir, note_stem)

    result = write_file(str(output_path), markdown, overwrite=False)

    if not result.get("success"):
        log_event("threads_write_failed", url=url, error=result.get("error", "unknown"))
        return result

    log_event("threads_saved", url=url, path=result["path"])
    _index_note(url, output_path)
    return {
        "success": True,
        "path": result["path"],
        "deduped": False,
        "note_title": title,
    }


def build_threads_markdown(payload: Dict[str, Any]) -> Tuple[str, str]:
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    normalized_url = normalize_url(payload.get("url", ""))

    author_name = payload.get("author_name", "")
    author_handle = payload.get("author_handle", "")
    text = payload.get("text", "") or ""
    published = payload.get("published_at", "")[:10] or today
    content_hash = str(payload.get("content_hash", ""))
    default_tags = _parse_tags(payload.get("default_tags", ""))
    post_id = payload.get("tweet_id", "")

    title = sanitize_filename(text.splitlines()[0] if text else (post_id or "threads-post"), max_len=60)

    lines = [
        "---",
        "aliases: []",
        f"tags: [{', '.join(default_tags)}]" if default_tags else "tags: []",
        "up:",
        f"url: {normalized_url}",
        f"author: {format_author(author_name, author_handle)}",
        f"published: {published}",
        "source: Threads",
        "platform: threads",
        f"content_hash: {content_hash}",
        f"생성 시간: {today}",
        f"수정 시간: {today}",
        "---",
        f"# {title}",
        "",
        "> [!INFO] 게시글 정보",
        f"> - 저자: {author_name or '@' + author_handle if author_handle else '알 수 없는 저자'}",
        f"> - 링크: {normalized_url}",
        f"> - 북마크 시간: {today}",
        "",
        "## 본문",
        "",
        text.strip() or "(본문 없음)",
    ]

    media_urls = payload.get("media_urls", []) or []
    if media_urls:
        media_lines = extract_media_lines(media_urls)
        if media_lines:
            lines.extend(["", "## 미디어", ""])
            lines.extend(media_lines)

    external_links = payload.get("external_links", []) or []
    if external_links:
        lines.extend(["", "## 링크", ""])
        for link in external_links:
            lines.append(f"- {link}")

    return "\n".join(lines).strip() + "\n", title


def _update_threads_note(existing_path: Path, payload: Dict[str, Any], url: str) -> Dict[str, Any]:
    markdown, title = build_threads_markdown(payload)

    if payload.get("download_media"):
        note_stem = existing_path.stem
        markdown = _download_media_files(markdown, existing_path.parent, note_stem)

    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        text = existing_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        text = ""

    updated = re.sub(
        r"^updated_at:.*$",
        f"updated_at: \"{now}\"",
        text,
        flags=re.MULTILINE,
    )
    if "updated_at:" not in updated:
        updated = re.sub(
            r"(---\n)",
            f"\\1updated_at: \"{now}\"\n",
            updated,
            count=1,
        )

    existing_path.write_text(markdown, encoding="utf-8")
    log_event("threads_updated", url=url, path=str(existing_path))
    return {
        "success": True,
        "path": str(existing_path),
        "deduped": False,
        "note_title": title,
    }


def archive_x_bookmark(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = normalize_url(str(payload.get("url", "")))
    output_dir_raw = str(payload.get("output_dir", "") or DEFAULT_OUTPUT_DIR).strip()
    if not output_dir_raw:
        return {"success": False, "error": "Obsidian 저장 디렉토리를 먼저 설정하세요."}
    output_dir, dir_err = validate_directory_path(output_dir_raw)
    if dir_err:
        return {"success": False, "error": dir_err}
    assert output_dir is not None

    if not re.match(r"^https://x\.com/[^/]+/status/\d+$", url):
        return {"success": False, "error": "invalid tweet url"}

    existing = detect_existing_note(url, output_dir)
    if not existing:
        log_event("archive_not_found", url=url)
        return {"success": True, "path": "", "archived": False, "reason": "note not found"}

    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        text = existing.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {"success": False, "error": "cannot read existing note"}

    if "archived: true" in text[:2000]:
        log_event("already_archived", url=url, path=str(existing))
        return {"success": True, "path": str(existing), "archived": True, "reason": "already archived"}

    updated = re.sub(
        r"^archived:.*$",
        "archived: true",
        text,
        flags=re.MULTILINE,
    )
    if "archived:" not in updated:
        updated = re.sub(
            r"(---\n)",
            "\\1archived: true\n",
            updated,
            count=1,
        )

    updated = re.sub(
        r"^archived_at:.*$",
        f"archived_at: \"{now}\"",
        updated,
        flags=re.MULTILINE,
    )
    if "archived_at:" not in updated:
        updated = re.sub(
            r"(archived: true\n)",
            f"\\1archived_at: \"{now}\"\n",
            updated,
            count=1,
        )

    existing.write_text(updated, encoding="utf-8")
    log_event("archived", url=url, path=str(existing))
    return {"success": True, "path": str(existing), "archived": True}


def main() -> None:
    try:
        message = read_message()
        if not message:
            log_event("empty_message")
            return

        action = message.get("action")

        if action == "ping":
            send_message({
                "success": True,
                "version": "2.5.0",
                "output_dir": DEFAULT_OUTPUT_DIR,
                "x_fetcher": str(X_FETCHER_PATH),
            })
            return

        if action == "pick_folder":
            send_message(pick_folder())
            return

        if action == "write_file":
            path = message.get("path", "")
            content = message.get("content", "")
            send_message(write_file(path, content, overwrite=False))
            return

        if action == "save_x_bookmark":
            payload = message.get("payload", {})
            send_message(save_x_bookmark(payload))
            return

        if action == "archive_x_bookmark":
            payload = message.get("payload", {})
            send_message(archive_x_bookmark(payload))
            return

        if action == "save_threads_bookmark":
            payload = message.get("payload", {})
            send_message(save_threads_bookmark(payload))
            return

        send_message({"success": False, "error": f"unknown action: {action}"})
    except Exception as exc:
        log_event("fatal_error", error=str(exc))
        try:
            send_message({"success": False, "error": str(exc)})
        except Exception:
            pass


if __name__ == "__main__":
    main()
